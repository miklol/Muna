//! The decision behind the webview's *permission requested* event (docs/modules/mirror.md):
//! which web permissions the app's own pages get, answered without a prompt — the notch window
//! is not focusable, so a runtime prompt could never be seen, let alone clicked.
//!
//! The policy is pure so the tests need no webview. The Windows handler
//! (`windows::webview::install_permission_handler`) maps the runtime's kinds onto
//! [`WebPermission`], asks [`PermissionPolicy::decide`] and writes the answer back.

use std::sync::atomic::{AtomicBool, Ordering};

/// A web permission a page can ask for. The list follows `COREWEBVIEW2_PERMISSION_KIND`;
/// anything newer than this build lands in `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebPermission {
    Camera,
    Microphone,
    Geolocation,
    Notifications,
    OtherSensors,
    ClipboardRead,
    MultipleAutomaticDownloads,
    FileReadWrite,
    Autoplay,
    LocalFonts,
    MidiSystemExclusiveMessages,
    WindowManagement,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Allow,
    Deny,
}

/// What the app's pages may use. Shared between the module that owns the setting (Mirror
/// flips the camera flag) and the shell that installs the handler on every webview.
#[derive(Debug, Default)]
pub struct PermissionPolicy {
    camera: AtomicBool,
}

impl PermissionPolicy {
    /// Everything denied.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Lets the app's own pages open the camera (`settings.modules.mirror.enabled`).
    pub fn set_camera_allowed(&self, allowed: bool) {
        self.camera.store(allowed, Ordering::Release);
    }

    #[must_use]
    pub fn camera_allowed(&self) -> bool {
        self.camera.load(Ordering::Acquire)
    }

    /// The answer for `kind` asked by the page at `request_uri` inside the document currently
    /// loaded at `document_uri`. Only the camera can be granted, only while it is allowed, and
    /// only to the document's own origin — a page from anywhere else (an embedded frame, a
    /// redirect) is denied whatever the setting says.
    #[must_use]
    pub fn decide(
        &self,
        kind: WebPermission,
        request_uri: &str,
        document_uri: &str,
    ) -> PermissionDecision {
        match kind {
            WebPermission::Camera
                if self.camera_allowed() && same_origin(request_uri, document_uri) =>
            {
                PermissionDecision::Allow
            }
            _ => PermissionDecision::Deny,
        }
    }
}

/// `scheme://host:port` of a URI, normalised the way the web platform compares origins:
/// scheme and host case-insensitive, the default port implied for `http` and `https`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
}

impl Origin {
    /// `None` for anything without `scheme://host`, including opaque origins such as
    /// `about:blank` and `data:` URIs, which never match anything.
    #[must_use]
    pub fn parse(uri: &str) -> Option<Self> {
        let uri = uri.trim();
        let (scheme, rest) = uri.split_once("://")?;
        if !scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            || !scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        {
            return None;
        }
        let authority = rest
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
            .rsplit('@')
            .next()
            .unwrap_or_default();
        let (host, port) = split_host_port(authority)?;
        if host.is_empty() {
            return None;
        }
        let scheme = scheme.to_ascii_lowercase();
        let port = match port {
            Some(port) => Some(port.parse::<u16>().ok()?),
            None => default_port(&scheme),
        };
        Some(Self {
            scheme,
            host: host.to_ascii_lowercase(),
            port,
        })
    }
}

/// `host:port` → (`host`, `Some(port)`), with bracketed IPv6 hosts kept whole.
fn split_host_port(authority: &str) -> Option<(&str, Option<&str>)> {
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = &authority[..=end + 1];
        let port = match &rest[end + 1..] {
            "" => None,
            tail => Some(tail.strip_prefix(':')?),
        };
        return Some((host, port));
    }
    Some(match authority.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    })
}

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" | "ws" => Some(80),
        "https" | "wss" => Some(443),
        _ => None,
    }
}

/// `true` when both URIs parse to the same origin. Opaque or malformed URIs never match.
#[must_use]
pub fn same_origin(a: &str, b: &str) -> bool {
    match (Origin::parse(a), Origin::parse(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = "http://tauri.localhost/";
    const DEV: &str = "http://localhost:1420/";

    #[test]
    fn everything_is_denied_by_default() {
        let policy = PermissionPolicy::new();
        for kind in [
            WebPermission::Camera,
            WebPermission::Microphone,
            WebPermission::Geolocation,
            WebPermission::Notifications,
            WebPermission::ClipboardRead,
            WebPermission::Autoplay,
            WebPermission::Unknown,
        ] {
            assert_eq!(
                policy.decide(kind, APP, APP),
                PermissionDecision::Deny,
                "{kind:?}"
            );
        }
    }

    #[test]
    fn camera_follows_the_flag_for_the_own_origin() {
        let policy = PermissionPolicy::new();
        policy.set_camera_allowed(true);
        assert!(policy.camera_allowed());
        assert_eq!(
            policy.decide(
                WebPermission::Camera,
                APP,
                "http://tauri.localhost/index.html"
            ),
            PermissionDecision::Allow
        );
        assert_eq!(
            policy.decide(WebPermission::Camera, DEV, "http://localhost:1420/?x=1#top"),
            PermissionDecision::Allow
        );
        policy.set_camera_allowed(false);
        assert_eq!(
            policy.decide(WebPermission::Camera, APP, APP),
            PermissionDecision::Deny
        );
    }

    #[test]
    fn camera_never_goes_to_another_origin() {
        let policy = PermissionPolicy::new();
        policy.set_camera_allowed(true);
        for other in [
            "https://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "http://evil.example/",
            "http://localhost:1421/",
            "about:blank",
            "data:text/html,hi",
            "",
        ] {
            assert_eq!(
                policy.decide(WebPermission::Camera, other, APP),
                PermissionDecision::Deny,
                "{other}"
            );
        }
        // A document without an origin (nothing loaded yet) grants nothing either.
        assert_eq!(
            policy.decide(WebPermission::Camera, APP, ""),
            PermissionDecision::Deny
        );
    }

    #[test]
    fn only_the_camera_is_ever_granted() {
        let policy = PermissionPolicy::new();
        policy.set_camera_allowed(true);
        for kind in [
            WebPermission::Microphone,
            WebPermission::Geolocation,
            WebPermission::Notifications,
            WebPermission::OtherSensors,
            WebPermission::ClipboardRead,
            WebPermission::MultipleAutomaticDownloads,
            WebPermission::FileReadWrite,
            WebPermission::Autoplay,
            WebPermission::LocalFonts,
            WebPermission::MidiSystemExclusiveMessages,
            WebPermission::WindowManagement,
            WebPermission::Unknown,
        ] {
            assert_eq!(
                policy.decide(kind, APP, APP),
                PermissionDecision::Deny,
                "{kind:?}"
            );
        }
    }

    #[test]
    fn origins_normalise_case_and_default_ports() {
        let origin = Origin::parse("HTTP://Tauri.LocalHost/some/path?q#frag").unwrap();
        assert_eq!(origin.scheme, "http");
        assert_eq!(origin.host, "tauri.localhost");
        assert_eq!(origin.port, Some(80));
        assert!(same_origin(
            "http://tauri.localhost",
            "http://tauri.localhost:80/"
        ));
        assert!(same_origin("https://a.example", "https://a.example:443"));
        assert!(!same_origin("https://a.example", "http://a.example"));
        assert!(same_origin(
            "http://user:pw@localhost:1420/",
            "http://localhost:1420/"
        ));
    }

    #[test]
    fn ipv6_hosts_keep_their_brackets() {
        let origin = Origin::parse("http://[::1]:1420/").unwrap();
        assert_eq!(origin.host, "[::1]");
        assert_eq!(origin.port, Some(1420));
        assert_eq!(Origin::parse("http://[::1]/").unwrap().port, Some(80));
        assert!(Origin::parse("http://[::1").is_none());
    }

    #[test]
    fn malformed_uris_have_no_origin() {
        for uri in [
            "",
            "about:blank",
            "tauri.localhost",
            "://nohost",
            "http://",
            "http:///path",
            "http://host:notaport/",
            "http://host:70000/",
            "1http://host/",
        ] {
            assert!(Origin::parse(uri).is_none(), "{uri}");
        }
        assert!(Origin::parse("file:///C:/x").is_none());
        assert_eq!(
            Origin::parse("custom://host/").unwrap().port,
            None,
            "unknown schemes have no default port"
        );
    }
}
