import UIKit
import UserNotifications

/// Notifications and background refresh.
///
/// Web Push does not work inside a WKWebView, so inside the app the phone
/// registers with Apple directly and hands the device token to the worker. The
/// worker keeps sending Web Push to everyone who uses the browser version, and
/// APNs to whoever has the app — the two live side by side on purpose, because
/// the whole unit is not going to move over on the same day.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Ask on second launch rather than the first: a permission sheet in the
        // first two seconds, before anyone has seen what the app is, gets a no.
        let seen = UserDefaults.standard.integer(forKey: "launches")
        UserDefaults.standard.set(seen + 1, forKey: "launches")
        if seen >= 1 { requestNotifications() }
        return true
    }

    func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
            guard ok else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func application(_ app: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await send(token: token) }
    }

    func application(_ app: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Nothing to do and nothing worth saying: the app is still usable, the
        // person simply gets no push until the next launch tries again.
    }

    /// The worker pairs the device token with whichever account is signed in on
    /// the web side. The widget token doubles as proof of that pairing, which
    /// is why this waits for it rather than firing on launch.
    private func send(token: String) async {
        guard let wt = Shared.token,
              let url = URL(string: Shared.origin + "/api/apns/register") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer " + wt, forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "token": token,
            "env": apnsEnvironment,
            "bundle": Bundle.main.bundleIdentifier ?? "",
        ])
        _ = try? await URLSession.shared.data(for: req)
    }

    /// A TestFlight or debug build gets a sandbox token, a store build a
    /// production one, and sending to the wrong host is rejected. The build
    /// tells the server which it is instead of the server guessing.
    private var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        if let path = Bundle.main.appStoreReceiptURL?.path, path.contains("sandboxReceipt") { return "sandbox" }
        return "production"
        #endif
    }

    /// A push arriving while the app is open still shows, because the thing it
    /// is telling you about is usually a watch starting in fifteen minutes.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        Shared.reloadWidget()
        return [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        Shared.reloadWidget()
    }

    /// A silent push wakes us just long enough to redraw the widget, which is
    /// the only way it stays right while nobody opens anything.
    func application(_ app: UIApplication,
                     didReceiveRemoteNotification info: [AnyHashable: Any]) async
        -> UIBackgroundFetchResult {
        _ = await WidgetAPI.fetch()
        Shared.reloadWidget()
        return .newData
    }
}
