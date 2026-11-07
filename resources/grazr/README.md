# grazr engine

The Python rotation engine behind Claude Accounts. It is copied into the app as an extra resource at `resources/grazr`, and packaged builds read it from `grazr/engine` under the app's resources directory. grazr was written by Wolfgang Klinger as a plugin for the Herdr terminal (https://github.com/wazum/herdr-grazr, MIT; his copyright notice is in `engine/LICENSE`). This copy comes from the fork https://github.com/senadaruc/herdr-grazr (branch `orca-port`), which adapts it for Orca; see `engine/` for the vendored files and `VERSION` for the version they were copied at.
