---
id: mobile-webview-config
title: Mobile WebView Misconfiguration
stages: [llm-scan, validate]
severity: high
description: Detects insecure WebView configurations — JavaScript bridges exposing native APIs, file access from URLs, SSL error suppression, and missing origin restrictions enabling XSS and local file exfiltration.
classical_prepass: semgrep
---

# Mobile WebView Misconfiguration

## Detection Prompt

```
You are hunting for WebView security misconfigurations in mobile apps. A misconfigured WebView can lead to JavaScript executing native device code, local file system exfiltration, or SSL stripping.

FIRST — Search for WebView usage:
  Android: search for WebView, WebViewClient, WebChromeClient, addJavascriptInterface in *.kt, *.java files
  iOS: search for WKWebView, UIWebView, WKNavigationDelegate, WKScriptMessageHandler in *.swift, *.m files
  React Native: search for WebView, <WebView in *.tsx, *.jsx, *.ts, *.js files
  Flutter: search for WebView, webview_flutter, InAppWebView, flutter_inappwebview in *.dart files

=== ANDROID WebView ===

Open every file that creates a WebView (WebView(context), findViewById with WebView).

1. JavaScript-enabled WebView with Native Bridge (CRITICAL):
   PATTERN: webView.settings.javaScriptEnabled = true (or setJavaScriptEnabled(true))
   THEN: webView.addJavascriptInterface(obj, "Android")
   This exposes ALL public methods of 'obj' to JavaScript.
   FLAG: What methods are on the bridged object? Can JS call methods that read files, execute commands, access contacts/location?
   Safe: Only bridge specific interface objects with @JavascriptInterface annotation AND validate message origins

2. File Access from URL Schemes:
   PATTERN: webView.settings.allowFileAccessFromFileURLs = true
   PATTERN: webView.settings.allowUniversalAccessFromFileURLs = true  ← CRITICAL — lets any file:// URL read ALL files
   PATTERN: webView.settings.allowFileAccess = true (default true on older APIs)
   If any of these are true AND the WebView loads remote content OR user-controlled URLs → FLAG CRITICAL

3. SSL Error Suppression (CRITICAL — enables MITM):
   PATTERN:
     override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
       handler?.proceed()  ← IGNORES the SSL error — attacker can MITM
     }
   PATTERN: handler.proceed() inside onReceivedSslError — ALWAYS FLAG THIS regardless of context

4. Mixed Content (HTTP in HTTPS WebView):
   PATTERN: webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
   This allows HTTP subresources in HTTPS pages — enables script injection via HTTP

5. Content Provider / Deep Link loading without validation:
   PATTERN: webView.loadUrl(intent.getStringExtra("url"))  ← user-controlled URL loaded directly
   PATTERN: webView.loadUrl(url) where url comes from an Intent extra or deep link

=== iOS WKWebView ===

Open every file using WKWebView.

1. Script Message Handlers (JavaScript → Native Bridge):
   PATTERN: configuration.userContentController.add(self, name: "appBridge")
   PATTERN: WKScriptMessageHandler implementation
   FLAG: What does userContentController(_:didReceive:) do with message.body?
   Is the message.body validated before performing native actions?
   Can JS call this handler with arbitrary message.body to trigger sensitive native operations?

2. UIWebView (DEPRECATED — insecure by default):
   PATTERN: UIWebView — this class is deprecated and inherently insecure (no WKContentWorld isolation)
   FLAG ALL UIWebView usage as high severity regardless of configuration

3. Navigation without origin validation:
   PATTERN: WKNavigationDelegate methods that do not check request.url.host before allowing navigation
   webView(_:decidePolicyFor:decisionHandler:) calling decisionHandler(.allow) without URL validation
   FLAG: Can the WebView navigate to arbitrary URLs from JS or server redirects?

4. evaluateJavaScript with user input:
   PATTERN: webView.evaluateJavaScript("processData('\(userInput)')")
   If userInput is not escaped, this is XSS in the native app context
   FLAG: any string interpolation in evaluateJavaScript() call

5. Disabled App Transport Security (ATS) for WebView:
   In Info.plist: NSAllowsArbitraryLoads = YES  ← applies to WebView too
   Or NSExceptionDomains with NSAllowsArbitraryLoads for specific domains used by WebView

=== REACT NATIVE WebView ===

Open files with <WebView or import { WebView } from 'react-native-webview'

1. JavaScript enabled with injected JavaScript and no origin check:
   javaScriptEnabled={true} with injectedJavaScript or injectedJavaScriptBeforeContentLoaded
   FLAG: What does the injected script do? Can it call onMessage with sensitive data?

2. onMessage handler without origin validation:
   PATTERN: onMessage={({ nativeEvent }) => { performAction(nativeEvent.data) }}
   Is nativeEvent.url checked before trusting nativeEvent.data?

3. Missing originWhitelist:
   <WebView source={{ uri: url }} />  ← no originWhitelist prop
   Should be: originWhitelist={['https://trusted-domain.com']}
   Without it, the WebView can navigate to any origin

4. allowsInlineMediaPlayback / mediaPlaybackRequiresUserAction — lower severity, but note if combined with remote content

5. User-supplied URLs loaded without validation:
   PATTERN: <WebView source={{ uri: props.url }} /> where props.url comes from route params or API response
   FLAG if the URL source is user-controlled or API-controlled without domain validation

=== FLUTTER InAppWebView ===

1. javascriptMode: JavascriptMode.unrestricted with JavaScript channels:
   addJavaScriptHandler(handlerName: 'bridge', callback: (args) { performAction(args) })
   FLAG: Is args validated? Can JS call this with arbitrary arguments?

2. onReceivedServerTrustAuthRequest returning ServerTrustAuthResponse(action: .proceed):
   This ignores SSL certificate errors — equivalent to handler?.proceed() in Android
```

## Validation Prompt

```
WebView config issue reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is JavaScript enabled? If so, is there a JavaScript-to-native bridge (addJavascriptInterface / WKScriptMessageHandler / onMessage)?
2. What does the bridge expose — can JS trigger sensitive native operations (file access, network, device APIs)?
3. Does the WebView load remote content, local bundled content only, or user-supplied URLs?
4. For SSL errors: does the code call handler.proceed() ignoring certificate errors?
5. For file access: are allowFileAccessFromFileURLs or allowUniversalAccessFromFileURLs enabled?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- WebViews that load ONLY bundled/local HTML files (no remote content, no user-controlled URLs) — file access may be intentional; reduce severity
- WKWebView has no `addJavascriptInterface` equivalent — each message handler is explicit; less risk than Android if message.body is validated
- OAuth flows requiring JavaScript for redirect handling — javaScriptEnabled is necessary; check that origin validation exists instead
- React Native WebView with `originWhitelist={['https://yourdomain.com']}` restricts navigation properly
- SSL error handling in DEBUG builds only (wrapped in `if (BuildConfig.DEBUG)`) — not a production risk
- WebViews with `setWebContentsDebuggingEnabled(false)` reduce attack surface even if JS is enabled
