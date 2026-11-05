import SwiftUI
import CryptoKit

enum DeskAccess { case staff, personal, sample, reviewer }

private enum DeskError: LocalizedError {
    case denied, unavailable
    var errorDescription: String? {
        switch self {
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

@MainActor final class DeskWorkspace: ObservableObject {
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

    func signIn(key rawKey: String) async {
        let key = rawKey.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !key.isEmpty, !busy else { return }
        let attempt = UUID(); generation = attempt; busy = true; message = ""
        defer { if generation == attempt { busy = false } }
        do {
            if key.hasPrefix("desk-review-") {
                try await client.verifyReviewer(key)
                guard generation == attempt else { return }
                showSample(.reviewer)
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
    func sample() {
        generation = UUID(); busy = false; message = ""
        showSample(.sample)
    }
    private func showSample(_ access: DeskAccess) {
        staffKey = ""; scope = "sample"
        (bookings,walkthroughs) = DeskSample.make()
        loadChecklist(); self.access = access
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
    func personal() {
        signOut(); scope = "personal"
        do {
            let url = try storageURL(filename:"personal-visits")
            if FileManager.default.fileExists(atPath:url.path) {
                bookings = try JSONDecoder().decode([DeskBooking].self, from:Data(contentsOf:url))
            }
            loadChecklist(); access = .personal
        } catch { signOut(); message = "The personal planner could not be opened. Please try again." }
    }
    func savePersonal(_ visit: DeskBooking) throws {
        guard access == .personal else { throw DeskError.denied }
        var next = bookings.filter { $0.id != visit.id }
        next.append(visit)
        try writePersonal(next)
    }
    func deletePersonal(_ id: String) throws {
        guard access == .personal else { throw DeskError.denied }
        try writePersonal(bookings.filter { $0.id != id })
        // Checklists contain no names or addresses; remove the deleted item's anonymous entry as well.
        completed.removeValue(forKey:id+"/1")
        try JSONEncoder().encode(completed).write(to:storageURL(), options:[.atomic,.completeFileProtection])
    }
    private func writePersonal(_ rows:[DeskBooking]) throws {
        try JSONEncoder().encode(rows).write(to:storageURL(filename:"personal-visits"), options:[.atomic,.completeFileProtection])
        bookings = rows
    }
    private func storageURL(filename: String? = nil) throws -> URL {
        let dir = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
            .appendingPathComponent("VisitPreparation",isDirectory:true)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        var folder = dir; var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try folder.setResourceValues(flags)
        return dir.appendingPathComponent((filename ?? scope)+".json")
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
            let data = try JSONEncoder().encode(next)
            try data.write(to:storageURL(),options:[.atomic,.completeFileProtection])
            completed = next; message = ""
        } catch { message = "The checklist could not be saved on this device. Please try again." }
    }
}
