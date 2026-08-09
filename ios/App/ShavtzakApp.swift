import SwiftUI
import WebKit
import UserNotifications

@main
struct ShavtzakApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .ignoresSafeArea(.container, edges: .bottom)
                .preferredColorScheme(nil)
        }
    }
}

struct RootView: View {
    var body: some View {
        WebHost()
            .background(Color(red: 11/255, green: 15/255, blue: 20/255))
    }
}

/// The whole UI is the web app. It is mature, in Hebrew, and already tested;
/// rewriting it in SwiftUI would take months and would immediately drift from
/// the version everyone uses in a browser. What the native shell adds is the
/// three things a web page cannot do: a home screen widget, notifications that
/// arrive through Apple rather than through Safari, and the app icon itself.
struct WebHost: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        // window.webkit.messageHandlers.sh — the app.js side calls this
        cfg.userContentController.add(context.coordinator, name: "sh")

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = false
        web.scrollView.bounces = true
        web.isOpaque = false
        web.backgroundColor = .clear
        // so the page can tell it is inside the app and not in a browser tab
        web.customUserAgent = (web.value(forKey: "userAgent") as? String ?? "") + " ShavtzakApp/1.0"
        context.coordinator.web = web
        web.load(URLRequest(url: URL(string: Shared.origin)!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    weak var web: WKWebView?

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "widget":
            // handed over once, right after sign-in
            if let token = body["token"] as? String, !token.isEmpty {
                Shared.token = token
            }
            if let origin = body["origin"] as? String, origin.hasPrefix("https://") {
                Shared.origin = origin
            }
            Shared.reloadWidget()
        case "refresh":
            Shared.reloadWidget()
        default:
            break
        }
    }

    /// Anything that is not our own site opens in Safari. A guard roster app has
    /// no business rendering someone else's page inside itself.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let scheme = url.scheme ?? ""
        if scheme == "tel" || scheme == "mailto" || scheme == "sms" {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        if url.absoluteString.hasPrefix(Shared.origin) || scheme == "about" {
            return decisionHandler(.allow)
        }
        if scheme == "http" || scheme == "https" {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.cancel)
    }

    /// target=_blank has nowhere to go in a single web view; send it to the
    /// same one rather than dropping the tap on the floor.
    func webView(_ webView: WKWebView, createWebViewWith cfg: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url {
            if url.absoluteString.hasPrefix(Shared.origin) { webView.load(action.request) }
            else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Shared.reloadWidget()
    }
}
