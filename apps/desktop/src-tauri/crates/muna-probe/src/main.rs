//! `muna-probe` — the M0-E3 identity spike (docs/spikes/m0-identity.md, ADR-0003).
//!
//! Exercises the identity-dependent `WinRT` APIs Muna's modules rely on and prints one line per
//! probe (I1–I6). The same lines go to `--out <file>` as JSON so the harness can collect
//! results from a process started through `Invoke-CommandInDesktopPackage`, which does not
//! forward stdout. Run it unpackaged (`cargo run -p muna-probe`), under an external-location
//! package and inside the MSIX; the report compares the three columns.
//!
//! Privacy rule: only counts, change kinds and notification ids are recorded — never a body.

mod options;
#[cfg(windows)]
mod probes;
mod report;

use std::process::ExitCode;

use options::Options;
use report::Reporter;

fn main() -> ExitCode {
    let options = match Options::parse(std::env::args().skip(1)) {
        Ok(Some(options)) => options,
        Ok(None) => {
            println!("{}", Options::USAGE);
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("muna-probe: {message}\n\n{}", Options::USAGE);
            return ExitCode::from(2);
        }
    };
    let mut reporter = match Reporter::new(options.out.as_deref()) {
        Ok(reporter) => reporter,
        Err(error) => {
            eprintln!("muna-probe: cannot open --out file: {error}");
            return ExitCode::from(2);
        }
    };
    reporter.header(&options);
    run(&options, &mut reporter);
    ExitCode::SUCCESS
}

#[cfg(windows)]
fn run(options: &Options, reporter: &mut Reporter) {
    probes::run_all(options, reporter);
}

#[cfg(not(windows))]
fn run(_options: &Options, reporter: &mut Reporter) {
    reporter.note("platform", "not windows; identity probes skipped");
}
