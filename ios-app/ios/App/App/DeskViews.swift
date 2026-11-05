import SwiftUI
import SafariServices

private enum DeskPrivacy { static let url=URL(string:"https://iman-staff-desk-review.vercel.app/privacy.html")! }

private let brand = Color(red:0.03,green:0.29,blue:0.32)

struct DeskRoot: View {
    @StateObject private var workspace = DeskWorkspace()
    var body: some View {
        Group {
            if workspace.access == nil { DeskSignIn() }
            else {
                TabView {
                    DeskVisits().tabItem { Label("Visits",systemImage:"calendar") }
                    if workspace.access != .personal { DeskWalkthroughs().tabItem { Label("Walkthroughs",systemImage:"building.2") } }
                    DeskSettings().tabItem { Label("Workspace",systemImage:"person.crop.circle") }
                }
            }
        }.environmentObject(workspace).accentColor(brand)
    }
}

private struct DeskSignIn: View {
    @EnvironmentObject var desk: DeskWorkspace
    @State private var key = ""
    @FocusState private var focus: Bool
    var body: some View {
        ScrollView {
            VStack(alignment:.leading, spacing:22) {
                Image(systemName:"calendar.badge.clock").font(.system(size:48,weight:.medium)).foregroundColor(brand)
                Text("IMAN Staff Desk").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                Text("Plan cleaning visits, review walkthrough requests, and prepare for each appointment.")
                    .foregroundColor(.secondary)
                VStack(alignment:.leading,spacing:8) {
                    Text("Staff access key").font(.headline)
                    SecureField("Enter your access key",text:$key).focused($focus)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.password)
                        .padding(12).background(Color(.secondarySystemBackground)).cornerRadius(10)
                        .submitLabel(.go).onSubmit { enter() }
                        .accessibilityIdentifier("staffKey")
                    if !desk.message.isEmpty { Text(desk.message).foregroundColor(.red).font(.footnote) }
                }
                Button(action:enter) {
                    Text(desk.busy ? "Signing in…" : "Sign in").frame(maxWidth:.infinity)
                }.buttonStyle(.borderedProminent).controlSize(.large).disabled(desk.busy || key.isEmpty)
                Divider()
                Button { focus = false; desk.personal() } label: {
                    Label("Open personal planner",systemImage:"calendar.badge.plus")
                }.buttonStyle(.bordered).controlSize(.large)
                Text("Create and prepare for your own visits. They stay on this device. No account required.").font(.footnote).foregroundColor(.secondary)
                Button { focus = false; desk.sample() } label: {
                    Label("Explore sample workspace",systemImage:"rectangle.stack.person.crop")
                }.buttonStyle(.bordered).controlSize(.large)
                Text("Try the visit planner using fictional bookings.").font(.footnote).foregroundColor(.secondary)
                Link("Privacy policy",destination:DeskPrivacy.url).font(.footnote)
            }.padding(28).frame(maxWidth:520).frame(maxWidth:.infinity)
        }
    }
    func enter() { focus = false; Task { await desk.signIn(key:key) } }
}

private struct DeskVisits: View {
    @EnvironmentObject var desk: DeskWorkspace
    @State private var query = ""
    @State private var upcoming = true
    @State private var addVisit = false
    var visits: [DeskVisit] {
        let midnight = DeskDates.calendar.startOfDay(for:Date())
        return desk.bookings.flatMap(\.visits).filter {
            let active = !(["Cancelled","Completed"].contains($0.booking.status ?? ""))
            return (!upcoming || ($0.date >= midnight && active)) &&
                matches(query,[$0.booking.name,$0.booking.serviceName,$0.booking.address,$0.booking.orderNumber])
        }.sorted { ($0.date,$0.id) < ($1.date,$1.id) }
    }
    var body: some View {
        NavigationView {
            List {
                Picker("Visit filter",selection:$upcoming) {
                    Text("Upcoming").tag(true);Text("All dates").tag(false)
                }.pickerStyle(.segmented)
                if !desk.message.isEmpty { Text(desk.message).foregroundColor(.red) }
                if visits.isEmpty {
                    if desk.access == .personal && desk.bookings.isEmpty {
                        Text("Add your first visit to start planning.").foregroundColor(.secondary)
                    } else { Text("No scheduled visits match this view.").foregroundColor(.secondary) }
                }
                else {
                    ForEach(visits) { visit in
                        NavigationLink(destination:DeskVisitDetail(visit:visit)) {
                            VStack(alignment:.leading,spacing:5) {
                                Text(visit.label).font(.subheadline).foregroundColor(brand)
                                Text(visit.booking.name).font(.headline)
                                Text(visit.booking.serviceName + (visit.isPair ? " · Visit \(visit.number) of 2" : ""))
                                    .font(.subheadline).foregroundColor(.secondary)
                            }.padding(.vertical,4)
                        }.accessibilityIdentifier("visit-"+visit.id)
                    }
                }
            }.navigationTitle(desk.access == .personal ? "My visits" : "Visits")
                .toolbar { ToolbarItem(placement:.navigationBarTrailing) { if desk.access == .personal {
                    Button { addVisit=true } label: { Label("Add visit",systemImage:"plus") }.accessibilityIdentifier("addVisit")
                } } }
                .sheet(isPresented:$addVisit) { PersonalVisitForm(existing:nil) }
                .searchable(text:$query,prompt:"Customer, address, or order")
                .refreshable { await desk.refreshBookings() }
        }.navigationViewStyle(.stack)
    }
}

private func matches(_ query: String, _ fields: [String?]) -> Bool {
    let needle=query.trimmingCharacters(in:.whitespacesAndNewlines)
    return needle.isEmpty || fields.compactMap { $0 }.contains { $0.localizedCaseInsensitiveContains(needle) }
}

private struct DeskAddress: View {
    let value: String
    @Environment(\.openURL) var openURL
    var body: some View {
        VStack(alignment:.leading,spacing:10) {
            Text(value)
            Button {
                var url = URLComponents(string:"https://maps.apple.com/")!
                url.queryItems = [URLQueryItem(name:"daddr",value:value)]
                if let destination=url.url { openURL(destination) }
            } label: { Label("Directions",systemImage:"arrow.triangle.turn.up.right.diamond") }
        }
    }
}

private struct DeskVisitDetail: View {
    @EnvironmentObject var desk: DeskWorkspace
    let initial: DeskVisit
    init(visit: DeskVisit) { initial = visit }
    var visit: DeskVisit { desk.bookings.first(where: { $0.id == initial.booking.id })?.visits.first(where:{ $0.number == initial.number }) ?? initial }
    @State private var editing = false
    @State private var deleting = false
    @State private var deleteError = ""
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            Section {
                Text(visit.booking.name).font(.title2.bold())
                Text(visit.booking.serviceName)
                Text(visit.label).foregroundColor(brand)
                if let status=visit.booking.status { Text(status) }
                if let number=visit.booking.orderNumber { Text("Order "+number).foregroundColor(.secondary).font(.footnote) }
            } header: { Text(visit.isPair ? "Visit \(visit.number) of 2" : "Appointment") }
            if let address=visit.booking.address, !address.isEmpty { Section("Service address") { DeskAddress(value:address) } }
            if let notes=visit.booking.notes, !notes.isEmpty { Section("Visit notes") { Text(notes) } }
            if let cents=visit.booking.estimate?.payment?.paidCents {
                Section("Payment received") { Text((Double(cents)/100).formatted(.currency(code:"USD"))) }
            }
            Section {
                ForEach(DeskTask.allCases) { task in
                    let done=desk.completed[visit.id,default:[]].contains(task.rawValue)
                    Button { desk.toggle(task,for:visit.id) } label: {
                        Label(task.rawValue,systemImage:done ? "checkmark.circle.fill" : "circle")
                            .foregroundColor(done ? brand : .primary)
                    }.accessibilityValue(done ? "Completed" : "Not completed")
                }
                if !desk.message.isEmpty { Text(desk.message).foregroundColor(.red).font(.footnote) }
            } header: {Text("Visit preparation")} footer:{Text("Your checklist is saved on this device.")}
            if desk.access == .personal {
                Section {
                    Button("Edit visit") { editing=true }
                    Button("Delete visit",role:.destructive) { deleting=true }
                    if !deleteError.isEmpty { Text(deleteError).foregroundColor(.red) }
                }
            }
        }.navigationTitle("Visit details").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented:$editing) { PersonalVisitForm(existing:visit.booking) }
            .alert("Delete this visit?",isPresented:$deleting) {
                Button("Delete",role:.destructive) { do { try desk.deletePersonal(initial.booking.id); dismiss() } catch { deleteError="The visit could not be deleted. Please try again." } }
                Button("Cancel",role:.cancel) {}
            } message: { Text("This removes the visit and its preparation checklist from this device.") }
    }
}

private struct DeskWalkthroughs: View {
    @EnvironmentObject var desk: DeskWorkspace
    @State private var query=""
    var hits:[DeskQuote] { desk.walkthroughs.filter { matches(query,[$0.name,$0.customerName,$0.address]) } }
    var body: some View {
        NavigationView {
            List {
                if !desk.walkthroughError.isEmpty {
                    Text(desk.walkthroughError).foregroundColor(.red)
                    Button("Retry") { Task { await desk.refreshWalkthroughs() } }
                } else if hits.isEmpty { Text("No matching walkthrough requests.").foregroundColor(.secondary) }
                ForEach(hits) { quote in
                    NavigationLink(destination:List {
                        Section("Visit") {
                            Text(quote.name).font(.headline)
                            if let customer=quote.customerName,customer != quote.name { Text(customer) }
                            Text(quote.scheduleLabel)
                            if let status=quote.status { Text(status).foregroundColor(brand) }
                        }
                        if let address=quote.address,!address.isEmpty { Section("Service address"){ DeskAddress(value:address) } }
                    }.navigationTitle("Walkthrough").navigationBarTitleDisplayMode(.inline)) {
                        VStack(alignment:.leading,spacing:6) { Text(quote.name).font(.headline); Text(quote.scheduleLabel).foregroundColor(.secondary) }
                    }
                }
            }.navigationTitle("Walkthroughs").searchable(text:$query,prompt:"Customer or commercial address")
                .task { await desk.refreshWalkthroughs() }.refreshable { await desk.refreshWalkthroughs() }
        }.navigationViewStyle(.stack)
    }
}

private struct DeskSettings: View {
    @EnvironmentObject var desk: DeskWorkspace
    @State private var crmError = false
    var body: some View {
        NavigationView {
            List {
                Section("Signed in to") {
                    Text(desk.access == .staff ? "IMAN staff workspace" : desk.access == .personal ? "Personal planner" : "Sample workspace")
                    if desk.access == .personal { Text("Visits and checklists stay on this device. They do not create a booking with IMAN.").foregroundColor(.secondary) }
                    else if desk.access != .staff { Text("Fictional records are separate from the staff CRM.").foregroundColor(.secondary) }
                }
                if desk.access == .staff {
                    Section("Staff tools") {
                        Button { crmError = !presentStaffCRM() } label: { Label("Open full CRM",systemImage:"person.2.crop.square.stack") }
                    }
                }
                Section("Support") {
                    Link("Contact IMAN",destination:URL(string:"https://www.imancleaningservice.com/contact.html")!)
                    Link("Privacy policy",destination:DeskPrivacy.url)
                }
                Button(desk.access == .sample ? "Leave sample workspace" : "Sign out") { desk.signOut() }
            }.navigationTitle("Workspace")
                .alert("Could not open the staff CRM",isPresented:$crmError) {
                    Button("OK",role:.cancel) {}
                } message: { Text("Please try again.") }
        }.navigationViewStyle(.stack)
    }
}

// Present Safari itself modally. The native app cannot read the staff web session or inject its key.
@MainActor private func presentStaffCRM() -> Bool {
    guard let scene=UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
          let root=scene.windows.first(where: { $0.isKeyWindow })?.rootViewController,
          root.presentedViewController == nil else { return false }
    root.present(SFSafariViewController(url:URL(string:"https://www.imancleaningservice.com/crm")!),animated:true)
    return true
}

private struct PersonalVisitForm: View {
    @EnvironmentObject var desk:DeskWorkspace
    @Environment(\.dismiss) private var dismiss
    let existing: DeskBooking?
    @State private var customer:String
    @State private var service:String
    @State private var address:String
    @State private var notes:String
    @State private var when:Date
    @State private var failure=""
    init(existing:DeskBooking?) {
        self.existing=existing
        _customer = State(initialValue:existing?.clientName ?? "")
        _service = State(initialValue:existing?.serviceLabel ?? "")
        _address = State(initialValue:existing?.address ?? "")
        _notes = State(initialValue:existing?.notes ?? "")
        _when = State(initialValue:DeskDates.parse(existing?.schedule) ?? Date())
    }
    var body:some View {
        NavigationView {
            Form {
                Section("Visit") {
                    TextField("Customer or visit name",text:$customer)
                    TextField("Service",text:$service)
                    DatePicker("New York time",selection:$when).environment(\.timeZone,DeskDates.zone)
                }
                Section("Optional details") {
                    TextField("Service address",text:$address)
                    TextField("Visit notes",text:$notes)
                }
                if !failure.isEmpty { Text(failure).foregroundColor(.red) }
            }.navigationTitle(existing == nil ? "Add visit" : "Edit visit").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement:.cancellationAction){ Button("Cancel"){ dismiss() } }
                    ToolbarItem(placement:.confirmationAction){ Button("Save"){ save() }.disabled(customer.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty) }
                }
        }.navigationViewStyle(.stack)
    }
    private func save() {
        let row=DeskBooking(id:existing?.id ?? UUID().uuidString,orderNumber:nil,clientName:customer.trimmingCharacters(in:.whitespacesAndNewlines),
            serviceLabel:service.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty ? nil : service,service:nil,status:"Planned",schedule:ISO8601DateFormatter().string(from:when),
            address:address,notes:notes,estimate:nil)
        do { try desk.savePersonal(row); dismiss() } catch { failure="Your visit could not be saved. Please try again." }
    }
}
