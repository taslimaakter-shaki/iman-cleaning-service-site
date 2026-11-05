import Foundation

enum DeskDates {
    static let zone = TimeZone(identifier: "America/New_York")!
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let parser = ISO8601DateFormatter()
        if let date = parser.date(from: value) { return date }
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: value)
    }
    static func label(_ date: Date, time: Bool = true) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.dateStyle = .medium
        formatter.timeStyle = time ? .short : .none
        return formatter.string(from: date)
    }
}

struct DeskBooking: Codable, Identifiable {
    let id: String
    let orderNumber: String?
    let clientName: String?
    let serviceLabel: String?
    let service: String?
    let status: String?
    let schedule: String?
    let address: String?
    let notes: String?
    let estimate: Estimate?
    struct Estimate: Codable {
        let payment: Payment?
        let secondVisitSchedule: String?
        let arrivalPreference: Arrival?
    }
    struct Payment: Codable {
        let paidCents: Int?
        let totalCents: Int?
    }
    struct Arrival: Codable { let windowLabel: String?; let flexible: Bool?; let confirmationStatus: String? }
    var name: String { clientName ?? "Customer" }
    var serviceName: String { serviceLabel ?? service ?? "Cleaning" }
    var visits: [DeskVisit] {
        let dates = [schedule, estimate?.secondVisitSchedule]
        return dates.enumerated().compactMap { offset, value in
            guard let date = DeskDates.parse(value) else { return nil }
            return DeskVisit(booking: self, date: date, number: offset+1, isPair: dates[1] != nil)
        }
    }
}

// Older CRM records may encode order IDs and cents as either text or numbers.
private extension KeyedDecodingContainer {
    func deskString(_ key: Key) -> String? {
        if let text = try? decode(String.self, forKey:key) { return text }
        return (try? decode(Int.self, forKey:key)).map(String.init)
    }
}
extension DeskBooking {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy:CodingKeys.self)
        guard let id = c.deskString(.id), !id.isEmpty else { throw DecodingError.dataCorruptedError(forKey:.id,in:c,debugDescription:"Missing booking ID") }
        self.init(id:id, orderNumber:c.deskString(.orderNumber), clientName:c.deskString(.clientName),
                  serviceLabel:c.deskString(.serviceLabel), service:c.deskString(.service), status:c.deskString(.status),
                  schedule:c.deskString(.schedule), address:c.deskString(.address), notes:c.deskString(.notes),
                  estimate:try? c.decode(Estimate.self, forKey:.estimate))
    }
}
extension DeskBooking.Payment {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy:CodingKeys.self)
        self.init(paidCents:c.deskString(.paidCents).flatMap(Int.init),totalCents:c.deskString(.totalCents).flatMap(Int.init))
    }
}

struct DeskVisit: Identifiable {
    let booking: DeskBooking
    let date: Date
    let number: Int
    let isPair: Bool
    var id: String { booking.id + "/" + String(number) }
    var flexible: Bool {
        booking.estimate?.arrivalPreference?.flexible == true &&
        booking.estimate?.arrivalPreference?.confirmationStatus != "confirmed"
    }
    var label: String {
        if flexible { return DeskDates.label(date, time: false) + " · " + (booking.estimate?.arrivalPreference?.windowLabel ?? "Flexible arrival") }
        return DeskDates.label(date)
    }
}

struct DeskQuote: Decodable, Identifiable {
    let id: String
    let businessName: String?
    let customerName: String?
    let address: String?
    let status: String?
    let walkthrough: Walkthrough?
    struct Walkthrough: Decodable {
        let preferredDate: String?
        let preferredTime: String?
        let confirmation: Confirmation?
    }
    struct Confirmation: Decodable { let date: String?; let time: String? }
    var name: String { if let businessName, !businessName.isEmpty { return businessName }; return customerName ?? "Walkthrough" }
    var scheduleLabel: String {
        let d = walkthrough?.confirmation?.date ?? walkthrough?.preferredDate ?? ""
        let t = walkthrough?.confirmation?.time ?? walkthrough?.preferredTime ?? ""
        let format = DateFormatter(); format.locale = Locale(identifier:"en_US_POSIX"); format.timeZone = DeskDates.zone
        format.dateFormat = t.isEmpty ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm"
        if let date = format.date(from: t.isEmpty ? d : d+" "+t) { return DeskDates.label(date, time: !t.isEmpty) }
        return [d,t].filter { !$0.isEmpty }.joined(separator: " ").isEmpty ? "To be scheduled" : [d,t].filter { !$0.isEmpty }.joined(separator:" ")
    }
}

enum DeskSample {
    static func make(now: Date = Date()) -> ([DeskBooking], [DeskQuote]) {
        let cal = DeskDates.calendar
        func day(_ offset: Int, hour: Int) -> Date {
            let midnight = cal.startOfDay(for:now)
            let next = cal.date(byAdding:.day,value:offset,to:midnight)!
            return cal.date(bySettingHour:hour,minute:0,second:0,of:next)!
        }
        let iso = ISO8601DateFormatter()
        let examples = [("Avery Lane","Deep cleaning",24000,0,9),("Jordan Reed","Recurring cleaning",20000,1,10),("Morgan Ellis","Move-out cleaning",38000,2,8),("Casey Brooks","Standard cleaning",18000,3,14)]
        let bookings = examples.enumerated().map { i, item in
            DeskBooking(id:"sample-visit-\(i)", orderNumber:"4100010\(i)", clientName:item.0,
                        serviceLabel:item.1, service:nil, status:"Confirmed", schedule:iso.string(from:day(item.3,hour:item.4)),
                        address:"\(120+i) Sample Lane, Brooklyn, NY", notes:i==0 ? "Review the kitchen and entryway before starting." : nil,
                        estimate:.init(payment:.init(paidCents:item.2/4,totalCents:item.2),secondVisitSchedule:nil,arrivalPreference:nil))
        }
        let df=DateFormatter();df.timeZone=DeskDates.zone;df.locale=Locale(identifier:"en_US_POSIX");df.dateFormat="yyyy-MM-dd"
        let quote = DeskQuote(id:"sample-walk-1",businessName:"Willow Studio",customerName:"Taylor Gray",
            address:"18 Example Street, Brooklyn, NY",status:"Walkthrough requested",
            walkthrough:.init(preferredDate:df.string(from:day(1,hour:11)),preferredTime:"11:00",confirmation:nil))
        return (bookings,[quote])
    }
}
