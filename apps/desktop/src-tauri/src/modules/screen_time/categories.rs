//! Categories (docs/modules/screen-time.md): eight buckets the panel colours and sums. Every
//! executable gets one from the rule table below by its lower-case file name; the user's
//! override on the app row wins when set. Unknown executables are *Other*.
//!
//! The table names common Windows apps only; it is a default, not a judgement, and is easy to
//! correct per app from the panel.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "camelCase")]
pub enum AppCategory {
    Browsing,
    Development,
    Communication,
    Media,
    Games,
    Productivity,
    System,
    Other,
}

impl AppCategory {
    /// Every category, in the order the legend lists them.
    pub const ALL: [Self; 8] = [
        Self::Browsing,
        Self::Development,
        Self::Communication,
        Self::Media,
        Self::Games,
        Self::Productivity,
        Self::System,
        Self::Other,
    ];

    /// The stored / wire name (`camelCase`, matching serde).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Browsing => "browsing",
            Self::Development => "development",
            Self::Communication => "communication",
            Self::Media => "media",
            Self::Games => "games",
            Self::Productivity => "productivity",
            Self::System => "system",
            Self::Other => "other",
        }
    }

    /// The category a stored override names; `None` for anything unknown (an older or newer
    /// build's value), which falls back to the rule.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|category| category.as_str() == value)
    }

    /// The default for `exe` (a lower-case file name), from the rule table.
    #[must_use]
    pub fn rule(exe: &str) -> Self {
        let exe = exe.trim().to_ascii_lowercase();
        if exe.is_empty() {
            return Self::Other;
        }
        RULES
            .iter()
            .find(|(names, _)| names.contains(&exe.as_str()))
            .map_or(Self::Other, |(_, category)| *category)
    }

    /// The category in force: the override when it names one, otherwise the rule.
    #[must_use]
    pub fn resolve(exe: &str, override_value: Option<&str>) -> Self {
        override_value
            .and_then(Self::parse)
            .unwrap_or_else(|| Self::rule(exe))
    }
}

const RULES: &[(&[&str], AppCategory)] = &[
    (
        &[
            "chrome.exe",
            "msedge.exe",
            "firefox.exe",
            "brave.exe",
            "opera.exe",
            "opera_gx.exe",
            "vivaldi.exe",
            "arc.exe",
            "iexplore.exe",
            "chromium.exe",
            "librewolf.exe",
            "waterfox.exe",
            "tor.exe",
            "zen.exe",
        ],
        AppCategory::Browsing,
    ),
    (
        &[
            "code.exe",
            "code - insiders.exe",
            "cursor.exe",
            "windsurf.exe",
            "zed.exe",
            "devenv.exe",
            "rider64.exe",
            "idea64.exe",
            "pycharm64.exe",
            "webstorm64.exe",
            "clion64.exe",
            "goland64.exe",
            "phpstorm64.exe",
            "datagrip64.exe",
            "studio64.exe",
            "windowsterminal.exe",
            "wt.exe",
            "powershell.exe",
            "pwsh.exe",
            "cmd.exe",
            "conhost.exe",
            "openconsole.exe",
            "mintty.exe",
            "git-bash.exe",
            "wsl.exe",
            "alacritty.exe",
            "wezterm-gui.exe",
            "sublime_text.exe",
            "notepad++.exe",
            "neovide.exe",
            "gvim.exe",
            "emacs.exe",
            "githubdesktop.exe",
            "gitkraken.exe",
            "fork.exe",
            "sourcetree.exe",
            "docker desktop.exe",
            "postman.exe",
            "insomnia.exe",
            "bruno.exe",
            "dbeaver.exe",
            "ssms.exe",
            "azuredatastudio.exe",
            "unity.exe",
            "unrealeditor.exe",
            "godot.exe",
            "windbg.exe",
            "windbgx.exe",
            "fiddler.exe",
            "wireshark.exe",
            "ilspy.exe",
            "dnspy.exe",
            "blend.exe",
        ],
        AppCategory::Development,
    ),
    (
        &[
            "teams.exe",
            "ms-teams.exe",
            "msteams.exe",
            "slack.exe",
            "discord.exe",
            "discordptb.exe",
            "discordcanary.exe",
            "zoom.exe",
            "telegram.exe",
            "whatsapp.exe",
            "signal.exe",
            "skype.exe",
            "outlook.exe",
            "olk.exe",
            "hxoutlook.exe",
            "thunderbird.exe",
            "webex.exe",
            "webexmta.exe",
            "messenger.exe",
            "element.exe",
            "mattermost.exe",
            "rocket.chat.exe",
            "viber.exe",
            "line.exe",
            "wechat.exe",
            "mailbird.exe",
            "em client.exe",
            "beeper.exe",
        ],
        AppCategory::Communication,
    ),
    (
        &[
            "spotify.exe",
            "vlc.exe",
            "mpc-hc64.exe",
            "mpc-hc.exe",
            "mpv.exe",
            "itunes.exe",
            "applemusic.exe",
            "appletv.exe",
            "music.ui.exe",
            "wmplayer.exe",
            "microsoft.media.player.exe",
            "video.ui.exe",
            "netflix.exe",
            "foobar2000.exe",
            "potplayer64.exe",
            "potplayermini64.exe",
            "obs64.exe",
            "audacity.exe",
            "photos.exe",
            "microsoft.photos.exe",
            "plex.exe",
            "plexamp.exe",
            "tidal.exe",
            "deezer.exe",
            "amazon music.exe",
            "kodi.exe",
            "stremio.exe",
            "youtube music desktop app.exe",
            "musicbee.exe",
            "aimp.exe",
            "winamp.exe",
        ],
        AppCategory::Media,
    ),
    (
        &[
            "steam.exe",
            "steamwebhelper.exe",
            "epicgameslauncher.exe",
            "battle.net.exe",
            "galaxyclient.exe",
            "origin.exe",
            "eadesktop.exe",
            "riotclientservices.exe",
            "riotclientux.exe",
            "leagueclient.exe",
            "leagueclientux.exe",
            "valorant.exe",
            "valorant-win64-shipping.exe",
            "ubisoftconnect.exe",
            "upc.exe",
            "xboxapp.exe",
            "xboxpcapp.exe",
            "gamingservicesui.exe",
            "minecraft.exe",
            "minecraftlauncher.exe",
            "javaw.exe",
            "robloxplayerbeta.exe",
            "robloxstudiobeta.exe",
            "cs2.exe",
            "csgo.exe",
            "dota2.exe",
            "overwatch.exe",
            "fortniteclient-win64-shipping.exe",
            "rocketleague.exe",
            "apex_legends.exe",
            "r5apex.exe",
            "gta5.exe",
            "eldenring.exe",
            "cyberpunk2077.exe",
            "playnite.desktopapp.exe",
            "playnite.fullscreenapp.exe",
            "itch.exe",
            "heroic.exe",
            "retroarch.exe",
        ],
        AppCategory::Games,
    ),
    (
        &[
            "winword.exe",
            "excel.exe",
            "powerpnt.exe",
            "onenote.exe",
            "onenoteim.exe",
            "msaccess.exe",
            "visio.exe",
            "winproj.exe",
            "mspub.exe",
            "soffice.exe",
            "soffice.bin",
            "notion.exe",
            "obsidian.exe",
            "logseq.exe",
            "todoist.exe",
            "ticktick.exe",
            "evernote.exe",
            "trello.exe",
            "asana.exe",
            "clickup.exe",
            "miro.exe",
            "figma.exe",
            "acrobat.exe",
            "acrord32.exe",
            "foxitpdfreader.exe",
            "sumatrapdf.exe",
            "photoshop.exe",
            "illustrator.exe",
            "lightroom.exe",
            "afterfx.exe",
            "premiere pro.exe",
            "adobe premiere pro.exe",
            "indesign.exe",
            "blender.exe",
            "gimp-2.10.exe",
            "gimp.exe",
            "inkscape.exe",
            "krita.exe",
            "affinity photo 2.exe",
            "affinity designer 2.exe",
            "affinity publisher 2.exe",
            "canva.exe",
            "davinci resolve.exe",
            "resolve.exe",
            "drawio.exe",
            "calibre.exe",
            "notepad.exe",
            "wordpad.exe",
            "mspaint.exe",
            "paintdotnet.exe",
            "calculatorapp.exe",
            "1password.exe",
            "bitwarden.exe",
            "keepass.exe",
            "keepassxc.exe",
            "anki.exe",
            "grammarly.exe",
            "stickynotes.exe",
            "microsoft.notes.exe",
            "typora.exe",
            "zotero.exe",
            "xmind.exe",
            "freeplane.exe",
            "audible.exe",
        ],
        AppCategory::Productivity,
    ),
    (
        &[
            "explorer.exe",
            "taskmgr.exe",
            "systemsettings.exe",
            "applicationframehost.exe",
            "shellexperiencehost.exe",
            "startmenuexperiencehost.exe",
            "searchhost.exe",
            "searchapp.exe",
            "searchui.exe",
            "lockapp.exe",
            "logonui.exe",
            "mmc.exe",
            "regedit.exe",
            "control.exe",
            "dllhost.exe",
            "rundll32.exe",
            "msiexec.exe",
            "consent.exe",
            "textinputhost.exe",
            "snippingtool.exe",
            "screenclippinghost.exe",
            "openwith.exe",
            "werfault.exe",
            "securityhealthsystray.exe",
            "securityhealthui.exe",
            "wwahost.exe",
            "runtimebroker.exe",
            "sihost.exe",
            "credentialuibroker.exe",
            "usoclient.exe",
            "musnotificationux.exe",
            "windowsstore.exe",
            "winstore.app.exe",
            "devicecensus.exe",
            "hxtsr.exe",
            "cleanmgr.exe",
            "dxdiag.exe",
            "msconfig.exe",
            "perfmon.exe",
            "resmon.exe",
            "eventvwr.exe",
            "winver.exe",
            "muna.exe",
            "notch.exe",
        ],
        AppCategory::System,
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_match_case_insensitively_and_default_to_other() {
        assert_eq!(AppCategory::rule("Code.exe"), AppCategory::Development);
        assert_eq!(AppCategory::rule("MSEDGE.EXE"), AppCategory::Browsing);
        assert_eq!(AppCategory::rule("spotify.exe"), AppCategory::Media);
        assert_eq!(AppCategory::rule("steam.exe"), AppCategory::Games);
        assert_eq!(AppCategory::rule("winword.exe"), AppCategory::Productivity);
        assert_eq!(AppCategory::rule("slack.exe"), AppCategory::Communication);
        assert_eq!(AppCategory::rule("explorer.exe"), AppCategory::System);
        assert_eq!(AppCategory::rule("some-new-app.exe"), AppCategory::Other);
        assert_eq!(AppCategory::rule(""), AppCategory::Other);
    }

    #[test]
    fn an_override_wins_and_an_unknown_override_falls_back() {
        assert_eq!(
            AppCategory::resolve("code.exe", Some("games")),
            AppCategory::Games
        );
        assert_eq!(
            AppCategory::resolve("code.exe", Some("space")),
            AppCategory::Development
        );
        assert_eq!(
            AppCategory::resolve("code.exe", None),
            AppCategory::Development
        );
    }

    #[test]
    fn names_round_trip_through_serde() {
        for category in AppCategory::ALL {
            let json = serde_json::to_string(&category).unwrap();
            assert_eq!(json, format!("\"{}\"", category.as_str()));
            assert_eq!(AppCategory::parse(category.as_str()), Some(category));
        }
    }

    #[test]
    fn no_executable_is_listed_twice() {
        let mut seen = std::collections::HashSet::new();
        for (names, _) in RULES {
            for name in *names {
                assert!(seen.insert(*name), "{name} appears in two categories");
                assert_eq!(*name, name.to_ascii_lowercase(), "{name} is not lower-case");
            }
        }
    }
}
