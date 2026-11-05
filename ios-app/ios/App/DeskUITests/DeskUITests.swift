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
    func requireLocked() {
        XCTAssertTrue(app.secureTextFields["staffKey"].waitForExistence(timeout:12))
        for label in ["Explore sample workspace", "Open personal planner", "My visit planner", "Open full CRM"] {
            XCTAssertFalse(app.buttons[label].exists, label)
        }
        XCTAssertFalse(app.tabBars.buttons["Visits"].exists)
    }
    func signInToReview() throws {
        guard let key = ProcessInfo.processInfo.environment["DESK_REVIEW_KEY"], !key.isEmpty else {
            throw XCTSkip("Set DESK_REVIEW_KEY in the test runner to test the isolated review workspace.")
        }
        requireLocked()
        let field = app.secureTextFields["staffKey"]
        field.tap()
        field.typeText(key.trimmingCharacters(in:.whitespacesAndNewlines)+"\n")
        XCTAssertTrue(app.buttons["visit-sample-visit-0/1"].waitForExistence(timeout:26))
    }
    func openPlanner() {
        let planner = app.buttons["My visit planner"]
        selectTab("Workspace", until:planner)
        planner.tap()
        XCTAssertTrue(app.buttons["addVisit"].waitForExistence(timeout:10))
    }
    func testLockedAtLaunch() { requireLocked() }

    func testAuthenticatedVisitsAndWalkthroughs() throws {
        try signInToReview()
        let visit = app.buttons["visit-sample-visit-0/1"]
        shot("01-Visits")
        visit.tap()
        let supplies = app.buttons["Check supplies and equipment"]
        XCTAssertTrue(supplies.waitForExistence(timeout:10))
        if supplies.value as? String != "Completed" { supplies.tap() }
        XCTAssertEqual(supplies.value as? String, "Completed")
        shot("02-Visit-preparation")
        app.terminate(); app.launch()
        try signInToReview()
        visit.tap()
        XCTAssertTrue(supplies.waitForExistence(timeout:10))
        XCTAssertEqual(supplies.value as? String, "Completed")
        let studio = app.buttons.containing(.staticText,identifier:"Willow Studio").firstMatch
        selectTab("Walkthroughs",until:studio); studio.tap()
        XCTAssertTrue(app.buttons["Directions"].waitForExistence(timeout:10))
        shot("03-Walkthrough")
        selectTab("Workspace",until:app.buttons["Sign out"])
        XCTAssertTrue(app.staticTexts["Review workspace"].exists)
        XCTAssertFalse(app.buttons["Open full CRM"].exists)
        app.buttons["Sign out"].tap()
        requireLocked()
    }
    func testPlannerRequiresSignInAndPersistsChanges() throws {
        try signInToReview(); openPlanner()
        XCTAssertFalse(app.staticTexts["Guest data protection fixture"].exists)
        app.buttons["addVisit"].tap()
        let example = "Cedar Lane Studio"
        enter(example, in:app.textFields["Customer or visit name"])
        enter("Weekly cleaning", in:app.textFields["Service"])
        enter("18 Example Lane, Brooklyn", in:app.textFields["Service address"])
        enter("Bring supplies for the entryway.", in:app.textFields["Visit notes"])
        app.buttons["Save"].tap()
        let row = app.buttons.containing(.staticText, identifier:example).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout:10)); row.tap()
        let supplies = app.buttons["Check supplies and equipment"]
        XCTAssertTrue(supplies.waitForExistence(timeout:10)); supplies.tap()
        app.buttons["Edit visit"].tap()
        XCTAssertTrue(app.navigationBars["Edit visit"].waitForExistence(timeout:10))
        shot("04-Personal-planner")
        enter(" Deep clean", in:app.textFields["Service"])
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Weekly cleaning Deep clean"].waitForExistence(timeout:10))
        app.terminate(); app.launch()
        try signInToReview(); openPlanner()
        XCTAssertTrue(row.waitForExistence(timeout:10)); row.tap()
        XCTAssertTrue(supplies.waitForExistence(timeout:10))
        XCTAssertEqual(supplies.value as? String,"Completed")
        app.buttons["Delete visit"].tap(); app.alerts.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["addVisit"].waitForExistence(timeout:10))
        XCTAssertFalse(row.exists)
        app.buttons["Done"].tap()
        let out = app.buttons["Sign out"]
        XCTAssertTrue(out.waitForExistence(timeout:10)); out.tap()
        requireLocked()
    }
    func testRejectedCredentials() {
        let field=app.secureTextFields["staffKey"]
        for key in ["desk-review-invalid", "invalid-staff-test-only"] {
            app.terminate(); app.launch()
            field.tap(); field.typeText(key+"\n")
            XCTAssertTrue(app.staticTexts["That access key was not accepted. Check it and try again."].waitForExistence(timeout:26))
            requireLocked()
        }
    }
}
