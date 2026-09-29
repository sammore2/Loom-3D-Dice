# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-09-29

### Changed
- Refactored and cleaned up core modules (`DiceBox`, `DiceColors`, `DiceFactory`, and `client.js`) for better maintainability and performance.
- Bumped addon version to `0.0.2`.

### Fixed
- Fixed dice simulation and roll handling stability issues.

### Added
- Added `manifest` and `download` release URLs to `addon.json` for LoomVTT auto-updates and marketplace integration.

## [0.0.1] - 2026-09-29

### Added
- Initial native release of **Loom 3D Dice** for LoomVTT, adapted from *Dice So Nice! v3.0.0-final*.
- Real-time 3D dice physics simulation powered by Three.js and Cannon.js.
- Automatic integration with LoomVTT chat rolls (`chat.roll`).
- In-game settings configuration window with interactive 3D preview.
- Sound effects with configurable table surfaces (Felt, Wood, etc.).
- Built-in materials (Plastic, Metal, Glass, Chrome, Wood), textures, and curated color presets.
- Multi-language support: English, Português (Brasil), Spanish, French, Italian, Korean, and Chinese.

[Unreleased]: https://github.com/sammore2/Loom-3D-Dice/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/sammore2/Loom-3D-Dice/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/sammore2/Loom-3D-Dice/releases/tag/v0.0.1
