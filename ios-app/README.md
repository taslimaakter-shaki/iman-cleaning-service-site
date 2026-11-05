# IMAN Staff Desk for iPhone and iPad

Open `ios/App/App.xcodeproj` in Xcode and choose the shared **App** scheme. The shipping app uses SwiftUI, Foundation and system frameworks. The older Capacitor config and tracked archives are historical; do not run Capacitor sync or select an older build for App Review.

- **Staff visit planner:** After sign-in, use Workspace → My visit planner to create, edit, or delete local visits. These entries and their checklists are isolated by authenticated workspace, protected on the device, and excluded from backups. Earlier guest files are never assigned to a staff or review workspace.
- **Staff workspace:** An authorized key retrieves bookings and walkthroughs from the existing staff CRM over HTTPS. Use Workspace → Open full CRM for the separately authenticated administration website.
- **Apple review:** A dedicated key opens fictional records after verification by the independent review service. Only the key hash belongs in that service. No production records or credentials belong in review notes, screenshots, or UI tests.
- **Testing:** Choose an iPhone or iPad simulator and run Product → Test. Set `DESK_REVIEW_KEY` in the test environment for the optional authenticated reviewer smoke test. The live rejection test sends only intentionally invalid keys. Screenshots for App Store Connect are XCTest attachments from the sample workflow.
- **Release:** Archive the App scheme for a generic iOS device. Select the new archive in Xcode Organizer and distribute it to App Store Connect, or use the existing export options. Verify the bundle ID, version, and build in App Store Connect before requesting review. Deploy `reviewer/` separately to its own project; never deploy the booking website as part of a native release.
