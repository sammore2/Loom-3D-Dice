# Loom 3D Dice

[![Engine: LoomVTT](https://img.shields.io/badge/LoomVTT-addon-blue.svg)](https://github.com/sammore2/Loom-3D-Dice)
[![Version](https://img.shields.io/badge/version-0.0.2-brightgreen.svg)](addon.json)
[![License: CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

**Loom 3D Dice** is a native 3D dice simulation addon for **LoomVTT**, featuring realistic physics, rich customization, sound effects, textures, materials, and themes.

Originally created by **Simone** and **JDW**, this project is a native port of *Dice So Nice! v3.0.0-final* adapted specifically for LoomVTT's architecture (`LoomHooks`, Loom SDK, native window manager, and settings registry).

---

## ✨ Features

- 🎲 **Real-Time 3D Physics:** Powered by Three.js and Cannon.js with realistic bounce, collision, and roll physics.
- 💬 **Seamless Chat Integration:** Automatically triggers when public dice rolls are made in the LoomVTT chat (`chat.roll`).
- 🎨 **Deep Customization:**
  - Custom dice colors, labels, outlines, and edges.
  - Material finishes: Plastic, Metal, Glass, Chrome, Wood, and more.
  - Textures and curated Color Sets.
  - Special dice geometries and preset faces.
- 🔊 **Realistic Sound Effects:** High-quality collision and rolling audio with selectable table surfaces (Felt, Wood, etc.).
- ⚙️ **Interactive Config Window:** Built-in settings panel with real-time 3D interactive preview.
- ⚡ **Performance & Display Controls:**
  - Configurable animation speed, throwing force, and shadow quality.
  - Bump mapping & realistic lighting.
  - Auto-scaling based on screen resolution.
  - Canvas layer placement (over or under Loom UI elements).
  - Configurable auto-hide delay and fade-out effects.
- 🌍 **Multi-language Support:** English, Portuguese (Brasil), Spanish, French, Italian, Korean, and Chinese.

---

## 📦 Installation

### Method 1: Marketplace / Addons Folder

1. Clone or extract this repository into your LoomVTT addons directory:
   ```bash
   cd <LoomVTT_Data>/marketplace/addons/
   git clone https://github.com/sammore2/dicesonice.git dice-so-nice
   ```
2. Restart or reload your LoomVTT instance.
3. Open your World settings or the Setup Hub and ensure **Loom 3D Dice** is enabled.

---

## 🚀 How to Use

Once enabled, **Loom 3D Dice** works automatically. Whenever you or any player rolls dice publicly in the chat, the 3D dice are rendered across the virtual table.

### Accessing Settings

1. Open **Game Settings** (Configurações do Jogo) in LoomVTT.
2. Under the Addons section, look for **Loom 3D Dice** and open the configuration window.
3. Use the interactive 3D preview to adjust your preferred appearance:
   - **Colorset / Theme:** Select a pre-configured theme or choose `Custom` to set individual colors.
   - **Materials & Textures:** Pick your preferred texture pattern and surface material.
   - **Audio & Table Surface:** Toggle dice sounds, volume, and contact surface.
   - **Physics & Animation:** Adjust throw strength and rolling speed.
4. Click **Save** to apply changes.

---

## 🛠️ Developer API

Other LoomVTT addons and game systems can interact directly with the 3D dice engine via `window.Loom.dice3d` and dedicated lifecycle hooks.

### Lifecycle Hooks

```javascript
import { LoomHooks } from '/_loom/sdk/index.js';

// Called when Dice3D begins initialization
LoomHooks.on('diceSoNiceInit', (dice3d) => {
  console.log('Dice So Nice is initializing...');
});

// Called when Dice3D is fully loaded and textures are cached
LoomHooks.on('diceSoNiceReady', (dice3d) => {
  console.log('Dice So Nice is ready to roll!', dice3d);
});
```

### Triggering Custom Rolls

```javascript
const d3d = window.Loom?.dice3d;
if (d3d && d3d.isEnabled()) {
  // Show 3D dice for a Loom chat roll object
  d3d.showForRoll(roll, window.Loom?.user ?? null);
}
```

### Registering Custom Colorsets

```javascript
window.Loom?.dice3d?.addColorset({
  name: 'dragonFire',
  description: 'Dragon Fire',
  category: 'Custom Themes',
  foreground: '#ffffff',
  background: '#e25822',
  outline: '#5a0000',
  edge: '#8b0000',
  material: 'metal',
  font: 'Arial'
});
```

### Registering Custom Textures

```javascript
window.Loom?.dice3d?.addTexture('myTexture', {
  name: 'Dragon Scales',
  composite: 'multiply',
  source: '/marketplace/addons/my-addon/textures/scales.png',
  bump: '/marketplace/addons/my-addon/textures/scales_bump.png'
});
```

### Registering Custom Dice Systems

```javascript
window.Loom?.dice3d?.addSystem({
  id: 'mysystem',
  name: 'My Custom System Dice'
});
```

---

## ⚙️ Configuration Options

| Setting | Scope | Description |
| :--- | :---: | :--- |
| `enabled` | Client | Enable/disable 3D dice rendering for this client. |
| `maxDiceNumber` | World | Maximum number of simultaneous 3D dice allowed per roll. |
| `disabledDuringCombat` | World | Automatically disable 3D animations during active combat encounters. |
| `immediatelyDisplayChatMessages` | World | Display chat messages immediately without waiting for dice roll animation. |
| `globalAnimationSpeed` | World | Enforce global animation speed for all players. |
| `diceCanBeFlipped` | World | Allow players to click on dice after rolling to rotate and inspect faces. |

---

## 🤝 Acknowledgments & Credits

- **Original Authors:** [Simone](https://github.com/riccisi) and **JDW**.
- **Upstream Repository:** [MSanteler/foundryvtt-dice-so-nice](https://github.com/MSanteler/foundryvtt-dice-so-nice)
- **Foundations:**
  - Based on the "Online 3D dice roller" by [Anton Natarov](http://www.teall.info/2014/01/online-3d-dice-roller.html).
  - Dice So Nice v2 physics enhancements based on [MajorVictory's](http://dnd.majorsplace.com/dice/) roller.
  - d10 Pentagonal Trapezohedron geometry by [Greewi](https://feerie.net).
- **Art & Themes:**
  - `Thylean Bronze` theme by **Spencer Thayer**.
  - Built-in theme packs by **MajorVictory**.
  - "Foyer" HDRI lighting map by [Joost Vanhoutte](https://joost3d.com/hdris/).

---

## 📄 License

This port for LoomVTT maintains the original licensing:
- Licensed under the [Creative Commons Attribution 4.0 International License (CC-BY-4.0)](http://creativecommons.org/licenses/by/4.0/).
- See [ATTRIBUTION.md](ATTRIBUTION.md) for full attribution details.