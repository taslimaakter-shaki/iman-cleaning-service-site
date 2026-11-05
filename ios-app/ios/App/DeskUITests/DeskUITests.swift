import XCTest

final class DeskUITests: XCTestCase {
    let app = XCUIApplication()
    override func setUp() { super.setUp(); continueAfterFailure=false; app.launch() }
    func tab(_ name:String) -> XCUIElement { app.descendants(matching:.any).matching(NSPredicate(format:"label == %@",name)).firstMatch }
    func selectTab(_ name:String,until element:XCUIElement) {
        let symbol = name=="Workspace" ? "person.crop.circle" : "building.2"
        let symbolic=app.buttons.matching(identifier:symbol).firstMatch
        let control=symbolic.exists ? symbolic : tab(name)
        for _ in 0..<2 {
            control.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5)).tap()
            if element.waitForExistence(timeout:6) { return }
        }
        XCTFail("The "+name+" view did not open")
    }
    func enter(_ text:String, in field:XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout:12))
        field.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout:3) { field.coordinate(withNormalizedOffset:CGVector(dx:0.4,dy:0.5)).tap() }
        app.typeText(text)
    }
    func shot(_ title:String) {
        let capture = XCTAttachment(screenshot:XCUIScreen.main.screenshot())
        capture.name=title; capture.lifetime = .keepAlways; add(capture)
    }
    func openSampleVisit() {
        app.buttons["Explore sample workspace"].tap()
        let row=app.buttons["visit-sample-visit-0/1"]
        XCTAssertTrue(row.waitForExistence(timeout:10)); row.tap()
    }
    func testSampleVisitChecklistAndWalkthrough() {
        app.buttons["Explore sample workspace"].tap()
        let row=app.buttons["visit-sample-visit-0/1"]
        XCTAssertTrue(row.waitForExistence(timeout:10))
        shot("01-Visits")
        row.tap()
        let item=app.buttons["Check supplies and equipment"]
        XCTAssertTrue(item.waitForExistence(timeout:6))
        if item.value as? String != "Completed" { item.tap() }
        XCTAssertEqual(item.value as? String,"Completed")
        shot("02-Visit-preparation")
        app.terminate(); app.launch(); openSampleVisit()
        XCTAssertEqual(item.value as? String,"Completed")
        let studio=app.buttons.containing(.staticText,identifier:"Willow Studio").firstMatch
        selectTab("Walkthroughs",until:studio)
        XCTAssertTrue(studio.waitForExistence(timeout:8)); studio.tap()
        XCTAssertTrue(app.buttons["Directions"].waitForExistence(timeout:10))
        shot("03-Walkthrough")
        selectTab("Workspace",until:app.buttons["Leave sample workspace"])
        XCTAssertFalse(app.buttons["Open full CRM"].exists)
        app.buttons["Leave sample workspace"].tap()
        XCTAssertTrue(app.secureTextFields["staffKey"].waitForExistence(timeout:12))
    }
    func testPersonalCreateEditPersistDelete() {
        app.buttons["Open personal planner"].tap()
        app.buttons["addVisit"].tap()
        let name=app.textFields["Customer or visit name"]
        let example="Private visit "+UUID().uuidString.prefix(4)
        enter(example,in:name)
        app.buttons["Save"].tap()
        let row=app.buttons.containing(.staticText,identifier:String(example)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout:8)); row.tap()
        app.buttons["Edit visit"].tap()
        let service=app.textFields["Service"]; enter("Weekly cleaning",in:service)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Weekly cleaning"].waitForExistence(timeout:6))
        let supplies = app.buttons["Check supplies and equipment"]
        supplies.tap()
        XCTAssertEqual(supplies.value as? String, "Completed")
        app.terminate(); app.launch(); app.buttons["Open personal planner"].tap()
        XCTAssertTrue(row.waitForExistence(timeout:8)); row.tap()
        XCTAssertEqual(supplies.value as? String, "Completed")
        app.buttons["Delete visit"].tap(); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["addVisit"].waitForExistence(timeout:6))
        app.terminate(); app.launch(); app.buttons["Open personal planner"].tap()
        XCTAssertTrue(app.buttons["addVisit"].waitForExistence(timeout:6)); XCTAssertFalse(row.exists)
    }
    func testRejectedCredentials() {
        let field=app.secureTextFields["staffKey"]
        for key in ["desk-review-invalid", "invalid-staff-test-only"] {
            app.terminate(); app.launch()
            field.tap(); field.typeText(key+"\n")
            XCTAssertTrue(app.staticTexts["That access key was not accepted. Check it and try again."].waitForExistence(timeout:26))
            XCTAssertFalse(app.tabBars.buttons["Visits"].exists)
        }
    }
    private func XCTSkipIfMissing(_ value:String?,_ reason:String) throws -> String { guard let value else { throw XCTSkip(reason) }; return value }
    func testAuthenticatedReview() throws {
        let key=try XCTSkipIfMissing(Bundle(for:type(of:self)).url(forResource:"review-key",withExtension:"txt").flatMap { try? String(contentsOf:$0) } ?? ProcessInfo.processInfo.environment["DESK_REVIEW_KEY"].map { $0 }, "This release smoke test requires the synthetic reviewer credential in the test runner, never in the app.")
        let field=app.secureTextFields["staffKey"]; field.tap(); field.typeText(key.trimmingCharacters(in:.whitespacesAndNewlines)+"\n")
        XCTAssertTrue(app.buttons["visit-sample-visit-0/1"].waitForExistence(timeout:26))
        selectTab("Workspace",until:app.buttons["Sign out"])
        XCTAssertTrue(app.staticTexts["Sample workspace"].exists); XCTAssertFalse(app.buttons["Open full CRM"].exists)
        app.buttons["Sign out"].tap(); XCTAssertTrue(field.waitForExistence(timeout:12))
    }
}
