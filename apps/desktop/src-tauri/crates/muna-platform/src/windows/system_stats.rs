//! Machine load through `sysinfo` (docs/modules/system-monitor.md, docs/04 "CPU / RAM / disk /
//! net"). CPU use comes from the PDH `% Idle Time` counters, memory from `GlobalMemoryStatusEx`,
//! volumes from the volume enumeration, network counters from `GetIfTable2` (hardware
//! interfaces only — sysinfo drops the loopback and other software adapters) and the process
//! walk from `NtQuerySystemInformation`. The counters live in one `System` behind a mutex so
//! every reading is the change since the previous one; nothing here runs on its own.

use std::collections::HashMap;
use std::ffi::OsStr;

use parking_lot::Mutex;
use sysinfo::{
    CpuRefreshKind, DiskRefreshKind, Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System,
};

use crate::types::{DiskSpace, ProcessUsage, SystemSample};

/// The `sysinfo` handles, created on the first sample: opening the PDH query is the slow part
/// and a machine that never opens the panel should not pay for it.
struct Counters {
    system: System,
    disks: Disks,
    networks: Networks,
    /// `true` once a CPU reading exists to difference against.
    primed: bool,
}

impl Counters {
    fn new() -> Self {
        Self {
            system: System::new(),
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
            primed: false,
        }
    }
}

/// [`crate::traits::SystemStats`] over `sysinfo`.
#[derive(Default)]
pub struct Sampler {
    counters: Mutex<Option<Counters>>,
}

impl std::fmt::Debug for Sampler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Sampler")
            .field(
                "primed",
                &self.counters.lock().as_ref().is_some_and(|c| c.primed),
            )
            .finish()
    }
}

impl Sampler {
    /// Never fails: every source degrades to zeros rather than an error, the way Task Manager
    /// keeps drawing when a counter is missing.
    #[must_use]
    pub fn sample(&self, top_processes: usize) -> SystemSample {
        let mut guard = self.counters.lock();
        let counters = guard.get_or_insert_with(Counters::new);
        let system_drive = std::env::var_os("SystemDrive");

        counters
            .system
            .refresh_cpu_specifics(CpuRefreshKind::nothing().with_cpu_usage());
        counters.system.refresh_memory();
        counters
            .disks
            .refresh_specifics(true, DiskRefreshKind::nothing().with_storage());
        counters.networks.refresh(true);

        let logical_cpus = counters.system.cpus().len().max(1);
        let cpu_percent = if counters.primed {
            Some(counters.system.global_cpu_usage().clamp(0.0, 100.0))
        } else {
            // PDH answers its first collection with nothing to difference against.
            counters.primed = true;
            None
        };

        let processes = if top_processes == 0 {
            Vec::new()
        } else {
            counters.system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cpu().with_memory(),
            );
            top_by_cpu(
                counters
                    .system
                    .processes()
                    .values()
                    .map(|process| (process.name(), process.cpu_usage(), process.memory())),
                logical_cpus,
                top_processes,
            )
        };

        let disks = counters
            .disks
            .list()
            .iter()
            .map(|disk| {
                let mount = disk.mount_point().to_string_lossy().into_owned();
                let label = disk.name().to_string_lossy();
                DiskSpace {
                    name: if label.is_empty() {
                        mount.clone()
                    } else {
                        label.into_owned()
                    },
                    system: is_system_drive(&mount, system_drive.as_deref()),
                    mount,
                    total_bytes: disk.total_space(),
                    available_bytes: disk.available_space(),
                    removable: disk.is_removable(),
                }
            })
            .collect();

        let (network_received_bytes, network_transmitted_bytes) = counters
            .networks
            .list()
            .values()
            .fold((0_u64, 0_u64), |(rx, tx), data| {
                (
                    rx.saturating_add(data.total_received()),
                    tx.saturating_add(data.total_transmitted()),
                )
            });

        SystemSample {
            cpu_percent,
            logical_cpus: u16::try_from(logical_cpus).unwrap_or(u16::MAX),
            memory_used_bytes: counters.system.used_memory(),
            memory_total_bytes: counters.system.total_memory(),
            disks,
            network_received_bytes,
            network_transmitted_bytes,
            processes,
        }
    }
}

/// `C:\` is the system volume when `SystemDrive` is `C:`.
fn is_system_drive(mount: &str, system_drive: Option<&OsStr>) -> bool {
    system_drive.is_some_and(|drive| {
        mount
            .trim_end_matches('\\')
            .eq_ignore_ascii_case(&drive.to_string_lossy())
    })
}

/// Groups processes by executable name (Task Manager's grouping), normalises CPU to the whole
/// machine and keeps the `limit` busiest. `cpu_usage` from `sysinfo` is per core (a two-core
/// hog reads 200), so the share of the machine is that over the core count.
fn top_by_cpu<'a>(
    processes: impl Iterator<Item = (&'a OsStr, f32, u64)>,
    logical_cpus: usize,
    limit: usize,
) -> Vec<ProcessUsage> {
    let mut groups: HashMap<String, ProcessUsage> = HashMap::new();
    for (name, cpu, memory) in processes {
        let name = display_name(name);
        if name.is_empty() {
            continue;
        }
        let entry = groups.entry(name.clone()).or_insert_with(|| ProcessUsage {
            name,
            ..ProcessUsage::default()
        });
        entry.cpu_percent += cpu;
        entry.memory_bytes = entry.memory_bytes.saturating_add(memory);
        entry.count = entry.count.saturating_add(1);
    }
    #[allow(clippy::cast_precision_loss)] // core counts are tiny
    let cores = logical_cpus.max(1) as f32;
    let mut rows: Vec<ProcessUsage> = groups
        .into_values()
        .map(|mut row| {
            row.cpu_percent = (row.cpu_percent / cores).clamp(0.0, 100.0);
            row
        })
        .collect();
    rows.sort_by(|a, b| {
        b.cpu_percent
            .total_cmp(&a.cpu_percent)
            .then_with(|| b.memory_bytes.cmp(&a.memory_bytes))
            .then_with(|| a.name.cmp(&b.name))
    });
    rows.truncate(limit);
    rows
}

/// "chrome.exe" → "chrome"; the pseudo-processes without a name are dropped by the caller.
fn display_name(name: &OsStr) -> String {
    let name = name.to_string_lossy();
    let trimmed = name.trim();
    match trimmed.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && extension.eq_ignore_ascii_case("exe") => {
            stem.to_owned()
        }
        _ => trimmed.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn processes_group_by_name_and_share_the_machine() {
        let rows = top_by_cpu(
            [
                (OsStr::new("chrome.exe"), 150.0, 100),
                (OsStr::new("Chrome.EXE"), 50.0, 100),
                (OsStr::new("muna.exe"), 8.0, 50),
                (OsStr::new("idle"), 0.0, 0),
                (OsStr::new(""), 400.0, 0),
            ]
            .into_iter(),
            8,
            2,
        );
        assert_eq!(rows.len(), 2);
        // The two Chrome rows differ in case, so they stay two names; the busiest one leads.
        assert_eq!(rows[0].name, "chrome");
        assert!((rows[0].cpu_percent - 150.0 / 8.0).abs() < f32::EPSILON);
        assert_eq!(rows[0].count, 1);
        assert_eq!(rows[1].name, "Chrome");
    }

    #[test]
    fn the_same_executable_aggregates_into_one_row() {
        let rows = top_by_cpu(
            [
                (OsStr::new("code.exe"), 10.0, 100),
                (OsStr::new("code.exe"), 30.0, 200),
            ]
            .into_iter(),
            4,
            5,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].count, 2);
        assert_eq!(rows[0].memory_bytes, 300);
        assert!((rows[0].cpu_percent - 10.0).abs() < f32::EPSILON);
    }

    #[test]
    fn display_names_drop_the_exe_extension_only() {
        assert_eq!(display_name(OsStr::new("chrome.exe")), "chrome");
        assert_eq!(display_name(OsStr::new("Muna.EXE")), "Muna");
        assert_eq!(display_name(OsStr::new("python3.12")), "python3.12");
        assert_eq!(display_name(OsStr::new(".exe")), ".exe");
        assert_eq!(display_name(OsStr::new("  ")), "");
    }

    #[test]
    fn the_system_drive_is_matched_by_letter() {
        assert!(is_system_drive(r"C:\", Some(OsStr::new("C:"))));
        assert!(is_system_drive(r"c:\", Some(OsStr::new("C:"))));
        assert!(!is_system_drive(r"D:\", Some(OsStr::new("C:"))));
        assert!(!is_system_drive(r"C:\", None));
    }

    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "reads the live machine; run with --features platform-tests"
    )]
    fn two_samples_produce_a_cpu_reading() {
        let sampler = Sampler::default();
        let first = sampler.sample(0);
        assert_eq!(first.cpu_percent, None);
        assert!(first.memory_total_bytes > 0);
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let second = sampler.sample(5);
        assert!(second.cpu_percent.is_some());
        assert!(!second.processes.is_empty());
        assert!(second.disks.iter().any(|disk| disk.system));
    }
}
