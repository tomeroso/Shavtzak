import Foundation
import WidgetKit

/// Everything the app and the widget both need.
///
/// The two run in different processes and cannot see each other's storage, so
/// the app group below is the only channel between them. The app writes the
/// widget token there once, after sign-in; the widget reads it and talks to the
/// server on its own from then on. Nothing else crosses.
enum Shared {
    /// Must match the App Group capability on BOTH targets.
    static let group = "group.com.shavtzak.app"
    static let tokenKey = "widgetToken"
    static let originKey = "origin"
    static let cacheKey = "lastView"

    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }

    static var token: String? {
        get { defaults.string(forKey: tokenKey) }
        set { defaults.set(newValue, forKey: tokenKey) }
    }

    /// Where the app lives. Kept in the group so a move to another domain does
    /// not need a new build of the widget.
    static var origin: String {
        get { defaults.string(forKey: originKey) ?? defaultOrigin }
        set { defaults.set(newValue, forKey: originKey) }
    }
    /// Set once, in project.yml (SH_ORIGIN). The app then overwrites it with
    /// whatever the page it actually loaded says, so moving to a custom domain
    /// later does not need a new build of the widget.
    static let defaultOrigin: String = {
        let v = Bundle.main.object(forInfoDictionaryKey: "SHOrigin") as? String ?? ""
        return v.hasPrefix("https://") ? v : "https://example.invalid"
    }()

    static func reloadWidget() {
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// One line of text per row, decided by the server. See widgetView() in the
/// worker: the phone deliberately does no Hebrew and no date maths, because a
/// second copy of those rules is a second set of bugs, in the one place we
/// cannot fix without another week of App Review.
struct WidgetView: Codable {
    var at: Double = 0
    var state: String = "none"          // on | soon | free | none
    var line1: String = ""
    var line2: String = ""
    var line3: String = ""
    var start: Double = 0
    var end: Double = 0
    var kind: String = ""               // watch | event
    var soon: [Item] = []

    struct Item: Codable, Hashable {
        var t: Double = 0
        var when: String = ""
        var label: String = ""
        var kind: String = ""
    }

    var startDate: Date? { start > 0 ? Date(timeIntervalSince1970: start / 1000) : nil }
    var endDate: Date? { end > 0 ? Date(timeIntervalSince1970: end / 1000) : nil }

    static let signedOut = WidgetView(state: "none", line1: "לא מחובר", line3: "פתח את האפליקציה")
    static let offline = WidgetView(state: "none", line1: "אין חיבור", line3: "מוצג מה שנשמר")
}

enum WidgetAPI {
    /// Ask the server what to draw. Returns nil on any failure, so the caller
    /// can fall back to the last answer rather than showing an error on a home
    /// screen, where an error is useless and permanent.
    static func fetch() async -> WidgetView? {
        guard let token = Shared.token,
              let url = URL(string: Shared.origin + "/api/widget") else { return nil }
        var req = URLRequest(url: url)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 12
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let view = try JSONDecoder().decode(WidgetView.self, from: data)
            Shared.defaults.set(data, forKey: Shared.cacheKey)
            return view
        } catch {
            return nil
        }
    }

    static var cached: WidgetView? {
        guard let data = Shared.defaults.data(forKey: Shared.cacheKey) else { return nil }
        return try? JSONDecoder().decode(WidgetView.self, from: data)
    }
}
