import SwiftUI
import CryptoKit

enum DeskAccess { case staff, reviewer, planner }

private enum DeskError: LocalizedError {
    case denied, unavailable, plannerUnavailable
    var errorDescription: String? {
        switch self {
        case .plannerUnavailable: return "The planner on this device could not be opened. Please try again."
        case .denied: return "That access key was not accepted. Check it and try again."
        case .unavailable: return "The workspace could not be loaded. Check your connection and try again."
        }
    }
}

// Never forward a staff or reviewer credential across a redirect.
private final class FixedOrigin: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class DeskClient {
    private let session: URLSession
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration:config,delegate:FixedOrigin(),delegateQueue:nil)
    }
    private func request<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for:request)
        guard let http = response as? HTTPURLResponse else { throw DeskError.unavailable }
        if [401,403].contains(http.statusCode) { throw DeskError.denied }
        guard http.statusCode == 200 else { throw DeskError.unavailable }
        return try JSONDecoder().decode(T.self, from:data)
    }
    func verifyReviewer(_ key: String) async throws {
        struct Identity: Decodable { let workspace: String; let account: String }
        var req = URLRequest(url:URL(string:"https://iman-staff-desk-review.vercel.app/api/session")!)
        req.httpMethod = "POST"
        req.setValue(key,forHTTPHeaderField:"x-review-key")
        let identity: Identity = try await request(req)
        guard identity.workspace == "sample" && identity.account == "app-review" else { throw DeskError.denied }
    }
    private func staffRequest(_ path: String, key: String) -> URLRequest {
        var req = URLRequest(url:URL(string:"https://www.imancleaningservice.com/api/crm/"+path)!)
        req.setValue(key,forHTTPHeaderField:"x-admin-token")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        return req
    }
    func bookings(key: String) async throws -> [DeskBooking] {
        struct Response: Decodable { let bookings: [DeskBooking] }
        let result: Response = try await request(staffRequest("bookings",key:key))
        return result.bookings
    }
    func walkthroughs(key: String) async throws -> [DeskQuote] {
        struct Response: Decodable { let quotes: [DeskQuote] }
        let result: Response = try await request(staffRequest("quotes",key:key))
        return result.quotes.filter { $0.walkthrough != nil && $0.status != "Deleted" }
    }
}

enum DeskTask: String, CaseIterable, Identifiable {
    case instructions = "Review access instructions"
    case supplies = "Check supplies and equipment"
    case arrival = "Review the arrival plan"
    var id: String { rawValue }
}

private struct PersonalPlannerFile: Codable {
    var visits: [DeskBooking]
    var checklists: [String: Set<String>]
}

@MainActor final class DeskWorkspace: ObservableObject, Identifiable {
    @Published private(set) var access: DeskAccess?
    @Published private(set) var bookings: [DeskBooking] = []
    @Published private(set) var walkthroughs: [DeskQuote] = []
    @Published private(set) var completed: [String: Set<String>] = [:]
    @Published var message = ""
    @Published var walkthroughError = ""
    @Published var busy = false
    private var staffKey = ""
    private var scope = ""
    private var generation = UUID()
    private let client = DeskClient()
    private weak var plannerOwner: DeskWorkspace?
    private var plannerSession: UUID?

    private var hasPlannerAccess: Bool {
        guard access == .planner, let owner = plannerOwner, owner.generation == plannerSession else { return false }
        return owner.access == .staff || owner.access == .reviewer
    }

    func signIn(key rawKey: String) async {
        let key = rawKey.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !key.isEmpty, !busy else { return }
        let attempt = UUID(); generation = attempt; busy = true; message = ""
        defer { if generation == attempt { busy = false } }
        do {
            if key.hasPrefix("desk-review-") {
                try await client.verifyReviewer(key)
                guard generation == attempt else { return }
                scope = "reviewer"
                (bookings, walkthroughs) = DeskSample.make()
                loadChecklist()
                access = .reviewer
            } else {
                let rows = try await client.bookings(key:key)
                guard generation == attempt else { return }
                bookings = rows; staffKey = key
                scope = "staff-" + SHA256.hash(data: Data(key.utf8)).prefix(12).map { String(format:"%02x",$0) }.joined()
                loadChecklist()
                access = .staff
            }
        } catch {
            if generation == attempt { message = (error as? DeskError)?.localizedDescription ?? DeskError.unavailable.localizedDescription }
        }
    }
    func refreshBookings() async {
        guard access == .staff else { return }
        let current = generation
        do {
            let rows = try await client.bookings(key:staffKey)
            guard generation == current else { return }
            bookings = rows; message = ""
        } catch { if generation == current { handle(error, forWalkthrough:false) } }
    }
    func refreshWalkthroughs() async {
        guard access == .staff else { return }
        let current = generation
        do {
            let rows = try await client.walkthroughs(key:staffKey)
            guard generation == current else { return }
            walkthroughs = rows; walkthroughError = ""
        } catch { if generation == current { handle(error, forWalkthrough:true) } }
    }
    private func handle(_ error: Error, forWalkthrough: Bool) {
        if let error = error as? DeskError, case .denied = error {
            signOut(); message = "Staff access has expired. Sign in again."
        } else if forWalkthrough { walkthroughError = DeskError.unavailable.localizedDescription }
        else { message = DeskError.unavailable.localizedDescription }
    }
    func signOut() {
        generation = UUID(); access = nil; staffKey = ""; scope = ""; bookings = []; walkthroughs = []
        completed = [:]; busy = false; message = ""; walkthroughError = ""
    }
    // Each signed-in workspace gets its own planner. Older guest files have no owner.
    func makePlanner() throws -> DeskWorkspace {
        guard access == .staff || access == .reviewer else { throw DeskError.denied }
        let planner = DeskWorkspace()
        planner.scope = scope + "-planner"
        planner.plannerOwner = self
        planner.plannerSession = generation
        do {
            let url = try planner.storageURL()
            if FileManager.default.fileExists(atPath: url.path) {
                let stored = try JSONDecoder().decode(PersonalPlannerFile.self, from: Data(contentsOf: url))
                planner.bookings = stored.visits
                planner.completed = stored.checklists
            }
        } catch { throw DeskError.plannerUnavailable }
        planner.access = .planner
        return planner
    }
    func savePersonal(_ visit: DeskBooking) throws {
        guard hasPlannerAccess else { throw DeskError.denied }
        var next = bookings.filter { $0.id != visit.id }
        next.append(visit)
        try persistPersonal(PersonalPlannerFile(visits: next, checklists: completed))
    }
    func deletePersonal(_ id: String) throws {
        guard hasPlannerAccess else { throw DeskError.denied }
        var next = completed
        for visit in bookings.first(where: { $0.id == id })?.visits ?? [] {
            next.removeValue(forKey: visit.id)
        }
        try persistPersonal(PersonalPlannerFile(visits: bookings.filter { $0.id != id }, checklists: next))
    }
    private func persistPersonal(_ planner: PersonalPlannerFile) throws {
        try JSONEncoder().encode(planner).write(to: storageURL(), options: [.atomic, .completeFileProtection])
        bookings = planner.visits
        completed = planner.checklists
    }
    private func storageURL() throws -> URL {
        let dir = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
            .appendingPathComponent("VisitPreparation",isDirectory:true)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        var folder = dir; var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try folder.setResourceValues(flags)
        return dir.appendingPathComponent(scope+".json")
    }
    private func loadChecklist() {
        completed = [:]
        do {
            let path = try storageURL()
            if FileManager.default.fileExists(atPath:path.path) { completed = try JSONDecoder().decode([String:Set<String>].self,from:Data(contentsOf:path)) }
        } catch { message = "The preparation checklist on this device could not be opened." }
    }
    func toggle(_ task: DeskTask, for id: String) {
        guard access != nil else { return }
        var next = completed
        if next[id,default:[]].contains(task.rawValue) { next[id]?.remove(task.rawValue) }
        else { next[id,default:[]].insert(task.rawValue) }
        do {
            if access == .planner {
                guard hasPlannerAccess else { return }
                try persistPersonal(PersonalPlannerFile(visits: bookings, checklists: next))
            } else {
                let data = try JSONEncoder().encode(next)
                try data.write(to:storageURL(),options:[.atomic,.completeFileProtection])
                completed = next
            }
            message = ""
        } catch { message = "The checklist could not be saved on this device. Please try again." }
    }
}
