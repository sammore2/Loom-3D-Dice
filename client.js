// ──────────────────────────────────────────
// dice-so-nice — native LoomVTT addon.
// Port completo do Dice So Nice! (Foundry) para a API do Loom:
// LoomHooks, settings, windowManager/BaseWindow, showToast.
// Motor 3D: Three.js r119 + cannon 0.6.2 vendored em dsn/libs/.
// ──────────────────────────────────────────
import { LoomHooks, settings, showToast, windowManager, BaseWindow } from '/_loom/sdk/index.js';
import { DiceNotation } from './dsn/DiceNotation.js';
import { DiceFactory } from './dsn/DiceFactory.js';
import { DiceBox } from './dsn/DiceBox.js';
import { DiceColors, TEXTURELIST, COLORSETS } from './dsn/DiceColors.js';
import { getColorsetGroups, getSystemList, isCustomColorset } from './dsn/appearance.js';

const MODULE = 'dice-so-nice';
export const BASE = '/marketplace/addons/dice-so-nice';

export const DEFAULT_OPTIONS = {
  hideAfterRoll: true,
  timeBeforeHide: 2000,
  hideFX: 'fadeOut',
  autoscale: true,
  scale: 75,
  speed: 1,
  globalAnimationSpeed: '0',
  shadowQuality: 'high',
  bumpMapping: true,
  sounds: true,
  soundsSurface: 'felt',
  soundsVolume: 0.5,
  canvasZIndex: 'over',
  throwingForce: 'medium',
};

export function DEFAULT_APPEARANCE(user = null) {
  const color = user?.color ?? '#CCCCCC';
  const factory = window.Loom?.dice3d?.DiceFactory;
  const sys = factory?.systemActivated || 'standard';
  return {
    labelColor: contrastOf(color),
    diceColor: color,
    outlineColor: color,
    edgeColor: color,
    texture: 'none',
    material: 'auto',
    colorset: 'custom',
    system: sys,
  };
}

export function contrastOf(color) {
  let c = String(color ?? '#CCCCCC');
  if (c.startsWith('#')) c = c.slice(1);
  if (c.length === 3) c = c.split('').map((h) => h + h).join('');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#FFFFFF';
}

// Escopo `client` do registry é só um wrapper de localStorage — mas toda
// definição registrada aparece na tela "Configurações do Jogo"
// (game-config-window.ts não filtra `config:false`). Como options/appearance
// são objetos editados pela janela do menu, persistem aqui direto, nas mesmas
// chaves que o registry usaria, sem poluir a UI.
const LS_OPTIONS = 'loom_setting_dice-so-nice_options';
const LS_APPEARANCE = 'loom_setting_dice-so-nice_appearance';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return { ...fallback };
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('[dice-so-nice] save failed:', err);
  }
}

function getOptions() {
  return loadJSON(LS_OPTIONS, DEFAULT_OPTIONS);
}

function saveOptions(patch) {
  saveJSON(LS_OPTIONS, { ...getOptions(), ...patch });
}

function getAppearance(user = null) {
  return loadJSON(LS_APPEARANCE, DEFAULT_APPEARANCE(user));
}

function saveAppearance(patch) {
  saveJSON(LS_APPEARANCE, { ...getAppearance(), ...patch });
}

function getAllConfig(user = null) {
  return { ...getOptions(), ...getAppearance(user) };
}

function getBoxConfig(user = null) {
  return {
    ...getAllConfig(user),
    maxDiceNumber: settings.get(MODULE, 'maxDiceNumber') ?? 20,
    diceCanBeFlipped: settings.get(MODULE, 'diceCanBeFlipped') ?? true,
    globalAnimationSpeed: settings.get(MODULE, 'globalAnimationSpeed') ?? '0',
  };
}

class Accumulator {
  constructor(delay, onEnd) {
    this._timeout = null;
    this._delay = delay;
    this._onEnd = onEnd;
    this._items = [];
  }
  addItem(item) {
    this._items.push(item);
    if (this._timeout) clearTimeout(this._timeout);
    const callback = () => {
      this._onEnd(this._items);
      this._timeout = null;
      this._items = [];
    };
    if (this._delay) this._timeout = setTimeout(callback, this._delay);
    else callback();
  }
}

export class Dice3D {
  static get DEFAULT_OPTIONS() { return { ...DEFAULT_OPTIONS }; }
  static DEFAULT_APPEARANCE(user = null) { return DEFAULT_APPEARANCE(user); }
  static get CONFIG() { return getOptions(); }
  static APPEARANCE(user = null) { return getAppearance(user); }
  static ALL_CONFIG(user = null) { return getAllConfig(user); }

  addSystem(system, forceActivate = false) {
    this.box.dicefactory.addSystem(system);
    if (forceActivate === 'force' || (this.box.dicefactory.systemActivated === 'standard' && forceActivate)) {
      this.box.dicefactory.setSystem(system.id, true);
    }
  }

  addDicePreset(dice, shape = null) {
    this.box.dicefactory.addDicePreset(dice, shape);
  }

  addTexture(textureID, textureData) {
    if (!textureData.bump) textureData.bump = '';
    return new Promise((resolve) => {
      const entry = {};
      entry[textureID] = textureData;
      TEXTURELIST[textureID] = textureData;
      DiceColors.loadTextures(entry, () => resolve());
    });
  }

  addColorset(colorset, apply = 'no') {
    const defaults = {
      foreground: 'custom', background: 'custom', outline: 'custom',
      edge: 'custom', texture: 'custom', material: 'custom',
    };
    colorset = { ...defaults, ...colorset };
    COLORSETS[colorset.name] = colorset;
    DiceColors.initColorSets(colorset);
    if (apply === 'force' || apply === 'default') {
      const saved = loadJSON(LS_APPEARANCE, {});
      if (!saved.colorset || apply === 'force') {
        saveAppearance({ colorset: colorset.name });
      }
    }
  }

  update(config) {
    if (this.box) this.box.update(config);
  }

  constructor() {
    LoomHooks.callAll('diceSoNiceInit', this);
    this._buildCanvas();
    this._initListeners();
    this._buildDiceBox();
    DiceColors.loadTextures(TEXTURELIST, () => {
      DiceColors.initColorSets();
      this.ready = true;
      LoomHooks.callAll('diceSoNiceReady', this);
    });
    this._startQueueHandler();
    this._nextAnimationHandler();
    // Driver da animação: intervalo do próprio addon, bombeando a caixa
    // a cada 30ms. neededSteps é calculado pelo relógio.
    setInterval(() => {
      try {
        if (this.box) this.box._pump();
      } catch (err) {
        console.error('[dice-so-nice] pump ERRO:', err);
      }
    }, 30);
  }

  _buildCanvas() {
    if (this.canvas) this.canvas.remove();
    this.canvas = document.createElement('div');
    this.canvas.id = 'dice-box-canvas';
    const over = getOptions().canvasZIndex !== 'under';
    // Visível desde o início (vazio não renderiza nada): o DiceBox mede o
    // container no initialize() e display:none retornaria 0x0.
    this.canvas.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;display:block;z-index:${over ? 1000 : 1};transition:opacity 1s;opacity:1;`;
    document.body.appendChild(this.canvas);
    this.currentCanvasPosition = getOptions().canvasZIndex;
    this.currentBumpMapping = getOptions().bumpMapping;
  }

  _buildDiceBox() {
    this.DiceFactory = new DiceFactory();
    const config = getBoxConfig(window.Loom?.user ?? null);
    config.boxType = 'board';
    this.box = new DiceBox(this.canvas, this.DiceFactory, config);
    this.boxInitialized = false;
    this.box.initialize().then(() => { this.boxInitialized = true; });
    this.box.preloadSounds();
  }

  _initListeners() {
    let rtime = 0;
    let timeout = false;
    const resizeEnd = () => {
      if (Date.now() - rtime < 1000) {
        setTimeout(resizeEnd, 1000);
      } else {
        timeout = false;
        this._buildCanvas();
        const config = getBoxConfig(window.Loom?.user ?? null);
        config.boxType = 'board';
        this.box = new DiceBox(this.canvas, this.DiceFactory, config);
        this.boxInitialized = false;
        this.box.initialize().then(() => { this.boxInitialized = true; });
        this.box.preloadSounds();
      }
    };
    window.addEventListener('resize', () => {
      rtime = Date.now();
      if (timeout === false) {
        timeout = true;
        setTimeout(resizeEnd, 1000);
      }
    });
    document.body.addEventListener('click', () => {
      const config = getOptions();
      if (!config.hideAfterRoll && this.canvas.style.display !== 'none' && !this.box.rolling) {
        this.canvas.style.display = 'none';
        this.box.clearAll();
      }
    });
  }

  _startQueueHandler() {
    this.queue = [];
    setInterval(() => {
      // initialize() é assíncrono (texturas HDR): sem câmera/cena prontas,
      // rollDice quebraria em this.camera.position.
      if (this.queue.length > 0 && this.boxInitialized && !this.box.rolling) {
        const animate = this.queue.shift();
        animate();
      }
    }, 100);
  }

  isEnabled() {
    const combat = window.Loom?.combat;
    const combatOff = !combat || !combat.isActive || !settings.get(MODULE, 'disabledDuringCombat');
    return settings.get(MODULE, 'enabled') !== false && combatOff;
  }

  update(config) {
    this.box.update(config);
  }

  async showForRoll(roll, user = null, synchronize = false, users = null, blind = false, messageID = null) {
    const context = { roll, user, users, blind };
    LoomHooks.callAll('diceSoNiceRollStart', messageID, context);
    const notation = new DiceNotation(context.roll, settings.get(MODULE, 'maxDiceNumber') ?? 20);
    const shown = await this.show(notation, context.user, synchronize, context.users, context.blind);
    LoomHooks.callAll('diceSoNiceRollComplete', messageID);
    return shown;
  }

  show(data, user = null, _synchronize = false, _users = null, blind = false) {
    return new Promise((resolve) => {
      // `immediatelyDisplayChatMessages` (addon.json): no Foundry original,
      // `false` ocultava o card do chat até a animação terminar. No Loom o
      // card nunca é ocultado — a animação sempre roda em paralelo ao chat —
      // então o comportamento efetivo já é "immediately display" nos dois
      // casos. Leitura explícita abaixo só para honrar a setting, sem mudar
      // comportamento.
      const immediatelyDisplay = settings.get(MODULE, 'immediatelyDisplayChatMessages');
      void immediatelyDisplay;
      if (!data.throws) throw new Error('Roll data should be not null');
      if (!data.throws.length || !data.throws[0].dice.length || !this.isEnabled()) {
        resolve(false);
      } else if (blind) {
        resolve(false);
      } else {
        // Sem relay de socket na v1: o servidor já faz broadcast do
        // chat.roll, cada cliente anima localmente ao receber.
        this._showAnimation(data, getAppearance(user)).then((displayed) => resolve(displayed));
      }
    });
  }

  _showAnimation(notation, dsnConfig) {
    notation.dsnConfig = dsnConfig;
    return new Promise((resolve) => {
      this.nextAnimation.addItem({ params: notation, resolve });
    });
  }

  _nextAnimationHandler() {
    const timing = settings.get(MODULE, 'enabledSimultaneousRolls') !== false ? 400 : 0;
    this.nextAnimation = new Accumulator(timing, (items) => {
      const commands = DiceNotation.mergeQueuedRollCommands(items);
      if (this.isEnabled() && this.queue.length < 10) {
        let count = commands.length;
        commands.forEach((aThrow) => {
          this.queue.push(() => {
            this._beforeShow();
            let done = false;
            const finish = (ok) => {
              if (done) return;
              done = true;
              clearTimeout(stallTimer);
              if (!--count) {
                for (const item of items) item.resolve(ok);
                this._afterShow();
              }
            };
            // Anti-travamento: se a física não concluir em 20s (estado
            // numérico corrompido, aba oculta, GPU suspensa...), libera a
            // fila em vez de bloquear todos os rolls seguintes.
            const stallTimer = setTimeout(() => {
              if (done) return;
              console.warn('[dice-so-nice] throw estagnado após 20s, liberando fila', { box: this.box._boxTag, iter: this.box.iteration });
              try {
                this.box._stopLoop();
                this.box.rolling = false;
                this.box.clearAll();
              } catch {}
              finish(true);
            }, 20000);
            try {
              this.box.start_throw(aThrow, () => finish(true));
            } catch (err) {
              console.error('[dice-so-nice] start_throw ERRO:', err);
              finish(false);
            }
          });
        });
      } else {
        for (const item of items) item.resolve(false);
      }
    });
  }

  _beforeShow() {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    // Primeiro exibe, DEPOIS mede: com display:none o clientWidth é 0 e
    // escala/câmera degeneram (era o bug dos skips pós-hide).
    this.canvas.style.opacity = '1';
    this.canvas.style.display = 'block';
    // Força reflow antes de medir.
    void this.canvas.offsetWidth;
    if (this.box.setDimensions) this.box.setDimensions();
  }

  _afterShow() {
    const config = getOptions();
    if (!config.hideAfterRoll) return;
    this.timeoutHandle = setTimeout(() => {
      if (this.box.rolling) return;
      if (config.hideFX === 'none') {
        this.canvas.style.display = 'none';
        this.box.clearAll();
      } else {
        // fadeOut sem jQuery: transição CSS + limpeza ao fim.
        this.canvas.style.opacity = '0';
        setTimeout(() => {
          // Se outra rolagem reabriu o canvas, não limpa.
          if (this.canvas.style.opacity === '0') {
            this.canvas.style.display = 'none';
            this.box.clearAll();
            this.canvas.style.opacity = '1';
          }
        }, 1000);
      }
    }, config.timeBeforeHide);
  }
}

// ──────────────────────────────────────────
// ──────────────────────────────────────────
// Janela de configuração (BaseWindow)
// ──────────────────────────────────────────
const CORE_I18N = {
  'DICESONICE.ColorCustom': '- Personalizada -',
  'DICESONICE.ColorBlack': 'Preto',
  'DICESONICE.ColorWhite': 'Branco',
  'DICESONICE.ColorFire': 'Fogo',
  'DICESONICE.ColorIce': 'Gelo',
  'DICESONICE.ColorBronze': 'Bronze',
  'DICESONICE.ColorRadiant': 'Radiante',
  'DICESONICE.ColorCoinDefault': 'Moeda Padrão',
  'DICESONICE.Colors': 'Cores',
  'DICESONICE.ThemesSoNice': 'Temas So Nice',
  'DICESONICE.DamageTypes': 'Tipos de Dano',
  'DICESONICE.AcquiredTaste': 'Gosto Adquirido',
  'DICESONICE.TextureNone': 'Nenhuma',
  'DICESONICE.MaterialAuto': 'Automático',
  'DICESONICE.MaterialPlastic': 'Plástico',
  'DICESONICE.MaterialMetal': 'Metal',
  'DICESONICE.MaterialGlass': 'Vidro',
  'DICESONICE.MaterialWood': 'Madeira',
  'DICESONICE.MaterialChrome': 'Cromado',
  'DICESONICE.settingsAppearance': 'Aparência',
  'DICESONICE.settingsPlayerPreferences': 'Preferências',
  'DICESONICE.system': 'Sistema de Dados',
  'DICESONICE.colorset': 'Tema de Cor',
  'DICESONICE.diceColor': 'Cor do Dado',
  'DICESONICE.labelColor': 'Cor do Número',
  'DICESONICE.outlineColor': 'Cor do Contorno',
  'DICESONICE.edgeColor': 'Cor da Borda',
  'DICESONICE.texture': 'Textura',
  'DICESONICE.material': 'Material',
  'DICESONICE.hideAfterRoll': 'Ocultar após rolagem',
  'DICESONICE.timeBeforeHide': 'Tempo antes de ocultar (ms)',
  'DICESONICE.hideFX': 'Efeito ao ocultar',
  'DICESONICE.autoSize': 'Escala automática',
  'DICESONICE.size': 'Tamanho',
  'DICESONICE.speed': 'Velocidade',
  'DICESONICE.canvasZIndex': 'Posição no Canvas',
  'DICESONICE.CanvasZIndexOver': 'Sobre fichas',
  'DICESONICE.CanvasZIndexUnder': 'Sob fichas',
  'DICESONICE.throwingForce': 'Força do lançamento',
  'DICESONICE.sounds': 'Áudio',
  'DICESONICE.soundsSurface': 'Superfície de som',
  'DICESONICE.soundsVolume': 'Volume',
  'DICESONICE.settingsPerformance': 'Desempenho',
  'DICESONICE.shadowQuality': 'Qualidade da sombra',
  'DICESONICE.bumpMapping': 'Mapeamento de relevo (Bump)',
  'DICESONICE.Reset': 'Restaurar padrões',
  'DICESONICE.Save': 'Configurações do Dice So Nice salvas.'
};

function loc(key, fallback = '') {
  if (!key) return fallback || '';
  const i18n = window.Loom?.i18n;
  if (i18n?.localize) {
    const val = i18n.localize(key);
    if (val && val !== key) return val;
  }
  return fallback || key;
}

const MATERIALS = [
  ['auto', 'DICESONICE.MaterialAuto', 'Auto'],
  ['plastic', 'DICESONICE.MaterialPlastic', 'Plastic'],
  ['metal', 'DICESONICE.MaterialMetal', 'Metal'],
  ['glass', 'DICESONICE.MaterialGlass', 'Glass'],
  ['wood', 'DICESONICE.MaterialWood', 'Wood'],
  ['chrome', 'DICESONICE.MaterialChrome', 'Chrome']
];

export class DiceConfigWindow extends BaseWindow {
  constructor() {
    super({ id: 'dice-config', title: 'Dice So Nice! — Config', icon: '🎲', width: 540, height: 'auto' });
    this.tabGroups = { primary: 'appearance' };
  }

  _cfg() {
    return { ...getOptions(), ...getAppearance(window.Loom?.user ?? null) };
  }

  bodyTemplate() {
    const c = this._cfg();
    const chk = (k) => (c[k] ? 'checked' : '');
    const sel = (k, opts) => opts.map(([v, l]) => `<option value="${v}" ${String(c[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
    const num = (k) => c[k] ?? '';
    const activeTab = this.tabGroups?.primary || 'appearance';

    return `
    <div class="dice-so-nice" style="padding:0.75rem 1rem;display:flex;flex-direction:column;max-height:82vh;box-sizing:border-box;color:#f8fafc;">
      <nav class="loom-window-tabs" style="display:flex;gap:0.4rem;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:0.5rem;margin-bottom:0.75rem;flex-shrink:0;">
        <a data-tab="appearance" data-group="primary" class="${activeTab === 'appearance' ? 'active' : ''}" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.35rem 0.75rem;border-radius:4px;cursor:pointer;font-weight:600;text-decoration:none;color:#ffffff;background:${activeTab === 'appearance' ? 'rgba(255,255,255,0.12)' : 'transparent'};">
          🎲 <span style="color:#ffffff;">${loc('DICESONICE.settingsAppearance', 'Appearance')}</span>
        </a>
        <a data-tab="preferences" data-group="primary" class="${activeTab === 'preferences' ? 'active' : ''}" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.35rem 0.75rem;border-radius:4px;cursor:pointer;font-weight:600;text-decoration:none;color:#ffffff;background:${activeTab === 'preferences' ? 'rgba(255,255,255,0.12)' : 'transparent'};">
          ⚙️ <span style="color:#ffffff;">${loc('DICESONICE.settingsPlayerPreferences', 'Preferences')}</span>
        </a>
      </nav>

      <div class="tab-content-container" style="overflow-y:auto;flex:1;padding-right:4px;color:#f8fafc;">
        <!-- ABA APARÊNCIA -->
        <div class="tab ${activeTab === 'appearance' ? 'active' : ''}" data-tab="appearance" data-group="primary" style="display:${activeTab === 'appearance' ? 'flex' : 'none'};flex-direction:column;gap:0.7rem;color:#f8fafc;">
          <div id="dsn-preview" style="width:100%;height:220px;background:radial-gradient(circle at center, #1e2337 0%, #0d111d 100%);border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;position:relative;box-shadow:inset 0 0 20px rgba(0,0,0,0.5);"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-weight:500;color:#f8fafc;font-size:0.95rem;">${loc('DICESONICE.system', 'Dice System')}</label>
            <select data-k="system" style="max-width:210px;padding:0.3rem 0.5rem;border-radius:4px;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);">${this._systemOptions(c.system)}</select>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-weight:500;color:#f8fafc;font-size:0.95rem;">${loc('DICESONICE.colorset', 'Color Theme')}</label>
            <select data-k="colorset" style="max-width:210px;padding:0.3rem 0.5rem;border-radius:4px;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);">${this._colorsetOptions(c.colorset)}</select>
          </div>

          <div class="dsn-custom-colors-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:0.6rem;">
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:0.9rem;color:#f8fafc;">
              <span style="color:#f8fafc;">${loc('DICESONICE.diceColor', 'Dice Color')}</span>
              <input type="color" data-k="diceColor" value="${c.diceColor}" style="width:2.2rem;height:1.8rem;border:none;background:transparent;cursor:pointer;"/>
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:0.9rem;color:#f8fafc;">
              <span style="color:#f8fafc;">${loc('DICESONICE.labelColor', 'Label Color')}</span>
              <input type="color" data-k="labelColor" value="${c.labelColor}" style="width:2.2rem;height:1.8rem;border:none;background:transparent;cursor:pointer;"/>
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:0.9rem;color:#f8fafc;">
              <span style="color:#f8fafc;">${loc('DICESONICE.outlineColor', 'Outline Color')}</span>
              <input type="color" data-k="outlineColor" value="${c.outlineColor}" style="width:2.2rem;height:1.8rem;border:none;background:transparent;cursor:pointer;"/>
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:0.9rem;color:#f8fafc;">
              <span style="color:#f8fafc;">${loc('DICESONICE.edgeColor', 'Edge Color')}</span>
              <input type="color" data-k="edgeColor" value="${c.edgeColor}" style="width:2.2rem;height:1.8rem;border:none;background:transparent;cursor:pointer;"/>
            </label>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-weight:500;color:#f8fafc;font-size:0.95rem;">${loc('DICESONICE.texture', 'Texture')}</label>
            <select data-k="texture" style="max-width:210px;padding:0.3rem 0.5rem;border-radius:4px;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);">${this._textureOptions(c.texture)}</select>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-weight:500;color:#f8fafc;font-size:0.95rem;">${loc('DICESONICE.material', 'Material')}</label>
            <select data-k="material" style="max-width:210px;padding:0.3rem 0.5rem;border-radius:4px;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);">${this._materialOptions(c.material)}</select>
          </div>
        </div>

        <!-- ABA PREFERÊNCIAS -->
        <div class="tab ${activeTab === 'preferences' ? 'active' : ''}" data-tab="preferences" data-group="primary" style="display:${activeTab === 'preferences' ? 'flex' : 'none'};flex-direction:column;gap:0.75rem;color:#f8fafc;">
          <fieldset style="border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:0.6rem 0.8rem;display:flex;flex-direction:column;gap:0.5rem;color:#f8fafc;">
            <legend style="font-size:0.85rem;font-weight:600;color:#38bdf8;padding:0 0.3rem;">${loc('DICESONICE.settingsPlayerPreferences', 'Display')}</legend>
            <label style="display:flex;gap:0.5rem;align-items:center;color:#f8fafc;cursor:pointer;"><input type="checkbox" data-k="hideAfterRoll" ${chk('hideAfterRoll')}/> <span style="color:#f8fafc;">${loc('DICESONICE.hideAfterRoll', 'Hide after roll')}</span></label>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.timeBeforeHide', 'Time before hide (ms)')}</span>
              <input type="number" data-k="timeBeforeHide" value="${num('timeBeforeHide')}" min="0" step="100" style="width:6.5rem;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;"/>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.hideFX', 'Hide effect')}</span>
              <select data-k="hideFX" style="max-width:180px;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;">${sel('hideFX', [['none', 'None'], ['fadeOut', 'Fade out']])}</select>
            </div>
            <label style="display:flex;gap:0.5rem;align-items:center;color:#f8fafc;cursor:pointer;"><input type="checkbox" data-k="autoscale" ${chk('autoscale')}/> <span style="color:#f8fafc;">${loc('DICESONICE.autoSize', 'Autoscale')}</span></label>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
              <span style="color:#f8fafc;">${loc('DICESONICE.size', 'Scale')}</span>
              <div style="display:flex;align-items:center;gap:0.5rem;flex:1;max-width:220px;">
                <input type="range" data-k="scale" min="20" max="150" value="${num('scale')}" style="flex:1;"/>
                <span class="range-scale-val" style="min-width:2.5rem;text-align:right;font-size:0.95rem;font-weight:600;color:#38bdf8;">${num('scale')}</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.speed', 'Speed')}</span>
              <select data-k="speed" style="max-width:180px;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;">${sel('speed', [['1', 'Normal (1x)'], ['2', '2x'], ['3', '3x']])}</select>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.canvasZIndex', 'Canvas position')}</span>
              <select data-k="canvasZIndex" style="max-width:180px;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;">${sel('canvasZIndex', [['over', loc('DICESONICE.CanvasZIndexOver', 'Over sheets')], ['under', loc('DICESONICE.CanvasZIndexUnder', 'Under sheets')]])}</select>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.throwingForce', 'Throwing force')}</span>
              <select data-k="throwingForce" style="max-width:180px;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;">${sel('throwingForce', [['weak', 'Weak'], ['medium', 'Medium'], ['strong', 'Strong']])}</select>
            </div>
          </fieldset>

          <fieldset style="border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:0.6rem 0.8rem;display:flex;flex-direction:column;gap:0.5rem;color:#f8fafc;">
            <legend style="font-size:0.85rem;font-weight:600;color:#38bdf8;padding:0 0.3rem;">${loc('DICESONICE.sounds', 'Audio')}</legend>
            <label style="display:flex;gap:0.5rem;align-items:center;color:#f8fafc;cursor:pointer;"><input type="checkbox" data-k="sounds" ${chk('sounds')}/> <span style="color:#f8fafc;">${loc('DICESONICE.sounds', 'Sounds')}</span></label>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.soundsSurface', 'Surface')}</span>
              <select data-k="soundsSurface" style="max-width:180px;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;">${sel('soundsSurface', [['felt', 'Felt'], ['wood_table', 'Wood table'], ['wood_tray', 'Wood tray'], ['metal', 'Metal']])}</select>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
              <span style="color:#f8fafc;">${loc('DICESONICE.soundsVolume', 'Volume')}</span>
              <div style="display:flex;align-items:center;gap:0.5rem;flex:1;max-width:220px;">
                <input type="range" data-k="soundsVolume" min="0" max="1" step="0.05" value="${c.soundsVolume ?? 0.5}" style="flex:1;"/>
                <span class="range-volume-val" style="min-width:2.5rem;text-align:right;font-size:0.95rem;font-weight:600;color:#38bdf8;">${Math.round((c.soundsVolume ?? 0.5) * 100)}%</span>
              </div>
            </div>
          </fieldset>

          <fieldset style="border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:0.6rem 0.8rem;display:flex;flex-direction:column;gap:0.5rem;color:#f8fafc;">
            <legend style="font-size:0.85rem;font-weight:600;color:#38bdf8;padding:0 0.3rem;">${loc('DICESONICE.settingsPerformance', 'Performance')}</legend>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#f8fafc;">${loc('DICESONICE.shadowQuality', 'Shadow quality')}</span>
              <select data-k="shadowQuality" style="max-width:180px;padding:0.25rem 0.4rem;background:#1a1f30;color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;">${sel('shadowQuality', [['none', 'None'], ['low', 'Low'], ['high', 'High']])}</select>
            </div>
            <label style="display:flex;gap:0.5rem;align-items:center;color:#f8fafc;cursor:pointer;"><input type="checkbox" data-k="bumpMapping" ${chk('bumpMapping')}/> <span style="color:#f8fafc;">${loc('DICESONICE.bumpMapping', 'Bump mapping')}</span></label>
          </fieldset>

          <div style="display:flex;justify-content:flex-end;margin-top:0.25rem;">
            <button class="btn" data-action="dsn-reset" style="padding:0.4rem 0.9rem;background:rgba(255,255,255,0.08);color:#ffffff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer;">${loc('DICESONICE.Reset', 'Reset defaults')}</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  _colorsetOptions(selected) {
    const groups = getColorsetGroups();
    return Object.entries(groups).map(([cat, items]) => {
      const catLabel = loc(cat, cat);
      const options = Object.entries(items).map(([name, desc]) => {
        const itemLabel = loc(desc, desc);
        return `<option value="${name}" ${String(selected) === name ? 'selected' : ''}>${itemLabel}</option>`;
      }).join('');
      return `<optgroup label="${catLabel}">${options}</optgroup>`;
    }).join('');
  }

  _textureOptions(selected) {
    return Object.entries(TEXTURELIST).map(([id, tex]) => {
      const label = loc(tex.name, id);
      return `<option value="${id}" ${String(selected) === id ? 'selected' : ''}>${label}</option>`;
    }).join('');
  }

  _materialOptions(selected) {
    return MATERIALS.map(([val, key, fallback]) => {
      const label = loc(key, fallback);
      return `<option value="${val}" ${String(selected) === val ? 'selected' : ''}>${label}</option>`;
    }).join('');
  }

  _systemOptions(selected) {
    const factory = window.Loom?.dice3d?.DiceFactory;
    const systems = factory ? getSystemList(factory) : [{ id: 'standard', name: 'standard' }];
    const current = selected || factory?.systemActivated || 'standard';
    return systems.map((s) => {
      const nameKey = s.name.startsWith('DICESONICE.') ? loc(s.name, s.name) : s.name;
      return `<option value="${s.id}" ${String(current) === s.id ? 'selected' : ''}>${nameKey}</option>`;
    }).join('');
  }

  _toggleControls() {
    // Custom colors
    const sel = this.element.querySelector('select[data-k="colorset"]');
    const custom = !sel || isCustomColorset(sel.value);
    this.element.querySelectorAll('input[data-k="diceColor"],input[data-k="labelColor"],input[data-k="outlineColor"],input[data-k="edgeColor"]').forEach((el) => {
      el.disabled = !custom;
    });

    // Autoscale toggle
    const auto = this.element.querySelector('input[data-k="autoscale"]')?.checked;
    const scaleInput = this.element.querySelector('input[data-k="scale"]');
    if (scaleInput) {
      scaleInput.disabled = !!auto;
      scaleInput.style.opacity = auto ? '0.45' : '1';
    }

    // Hide after roll toggle
    const hide = this.element.querySelector('input[data-k="hideAfterRoll"]')?.checked;
    const timeInput = this.element.querySelector('input[data-k="timeBeforeHide"]');
    const fxSelect = this.element.querySelector('select[data-k="hideFX"]');
    if (timeInput) timeInput.disabled = !hide;
    if (fxSelect) fxSelect.disabled = !hide;

    // Sounds toggle
    const sounds = this.element.querySelector('input[data-k="sounds"]')?.checked;
    const surfSelect = this.element.querySelector('select[data-k="soundsSurface"]');
    const volInput = this.element.querySelector('input[data-k="soundsVolume"]');
    if (surfSelect) surfSelect.disabled = !sounds;
    if (volInput) {
      volInput.disabled = !sounds;
      volInput.style.opacity = sounds ? '1' : '0.45';
    }
  }

  _previewConfig() {
    const { options, appearance } = this._splitForm(this._readForm());
    const el = this.element.querySelector('#dsn-preview');
    const w = el?.clientWidth || 480;
    return {
      ...getOptions(), ...options,
      ...getAppearance(window.Loom?.user ?? null), ...appearance,
      dimensions: { w, h: 220 },
      autoscale: false,
      scale: 60,
      boxType: 'showcase',
    };
  }

  _buildPreview() {
    const d3d = window.Loom?.dice3d;
    const el = this.element.querySelector('#dsn-preview');
    if (!d3d || !d3d.boxInitialized || !el) return;
    if (this.previewBox) {
      this.previewBox._stopLoop?.();
      this.previewBox.clearAll?.();
      this.previewBox = null;
    }
    const canvasEl = el;
    canvasEl.innerHTML = '';
    const config = this._previewConfig();
    this.previewBox = new DiceBox(canvasEl, d3d.DiceFactory, config);
    this.previewBox.initialize().then(() => {
      if (this.element.isConnected) {
        this.previewBox.showcase(config);
      }
    });

    if (!this._previewAnimInterval) {
      this._previewAnimInterval = setInterval(() => {
        if (this.previewBox && this.element.isConnected) {
          try {
            this.previewBox._pump();
          } catch (e) {
            console.error('[dice-so-nice] preview pump error:', e);
          }
        }
      }, 33);
    }
  }

  _refreshPreview() {
    if (!this.previewBox || !this.element.isConnected) return;
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => {
      const config = this._previewConfig();
      this.previewBox.update(config);
      this.previewBox.showcase(config);
    }, 150);
  }

  activateListeners(html) {
    super.activateListeners?.(html);

    const root = (html instanceof HTMLElement) ? html : (html?.[0] || this.element);
    if (!root) return;

    // Tab switching
    const tabs = root.querySelectorAll('nav.loom-window-tabs [data-tab]');
    tabs.forEach((tabBtn) => {
      tabBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = tabBtn.dataset.tab;
        const group = tabBtn.dataset.group || 'primary';
        this.tabGroups = this.tabGroups || {};
        this.tabGroups[group] = tabName;

        tabs.forEach((t) => {
          if (t.dataset.group === group) {
            t.classList.toggle('active', t.dataset.tab === tabName);
            t.style.background = t.dataset.tab === tabName ? 'rgba(255,255,255,0.1)' : 'transparent';
          }
        });
        root.querySelectorAll(`.tab[data-group="${group}"]`).forEach((tabContent) => {
          const isActive = tabContent.dataset.tab === tabName;
          tabContent.classList.toggle('active', isActive);
          tabContent.style.display = isActive ? 'flex' : 'none';
        });

        if (tabName === 'appearance') {
          setTimeout(() => {
            if (!this.previewBox) {
              this._buildPreview();
            } else {
              this._refreshPreview();
            }
          }, 60);
        }
      });
    });

    // Range slider value displays
    const scaleRange = root.querySelector('input[data-k="scale"]');
    const scaleVal = root.querySelector('.range-scale-val');
    if (scaleRange && scaleVal) {
      scaleRange.addEventListener('input', () => { scaleVal.textContent = scaleRange.value; });
    }
    const volRange = root.querySelector('input[data-k="soundsVolume"]');
    const volVal = root.querySelector('.range-volume-val');
    if (volRange && volVal) {
      volVal.textContent = Math.round(Number(volRange.value) * 100) + '%';
      volRange.addEventListener('input', () => { volVal.textContent = Math.round(Number(volRange.value) * 100) + '%'; });
    }

    this._buildPreview();
    this._toggleControls();

    if (!this._eventsBound) {
      this._eventsBound = true;
      this.element.addEventListener('input', () => {
        this._refreshPreview();
        this._toggleControls();
      });
      this.element.addEventListener('change', () => {
        this._refreshPreview();
        this._toggleControls();
      });
    }
  }

  _cleanupPreview() {
    if (this._previewAnimInterval) {
      clearInterval(this._previewAnimInterval);
      this._previewAnimInterval = null;
    }
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
    if (this.previewBox) {
      try {
        this.previewBox._stopLoop?.();
        this.previewBox.clearAll?.();
      } catch (e) {
        console.warn('[dice-so-nice] preview cleanup error:', e);
      }
      this.previewBox = null;
    }
  }

  async onClose() {
    this._cleanupPreview();
  }

  close() {
    this._cleanupPreview();
    windowManager.close(this.options.id);
  }

  _readForm() {
    const els = this.element.querySelectorAll('[data-k]');
    const out = {};
    els.forEach((el) => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (el.type === 'number' || el.type === 'range') out[k] = Number(el.value);
      else out[k] = el.value;
    });
    return out;
  }

  _splitForm(form) {
    const optKeys = Object.keys(DEFAULT_OPTIONS);
    const options = {};
    const appearance = {};
    for (const [k, v] of Object.entries(form)) {
      if (k === 'enabled') continue;
      if (optKeys.includes(k)) options[k] = v;
      else appearance[k] = v;
    }
    return { options, appearance };
  }

  async _save() {
    try {
      const { options, appearance } = this._splitForm(this._readForm());
      delete options.enabled;
      saveOptions(options);
      saveAppearance(appearance);
      const d3d = window.Loom?.dice3d;
      if (d3d) {
        const fresh = getBoxConfig(window.Loom?.user ?? null);
        if (fresh.canvasZIndex !== d3d.currentCanvasPosition) {
          d3d._buildCanvas();
          d3d.currentCanvasPosition = fresh.canvasZIndex;
        }
        if (d3d.box && d3d.boxInitialized) {
          try {
            d3d.update(fresh);
          } catch (e) {
            console.warn('[dice-so-nice] d3d update error:', e);
          }
        }
      }
      showToast(loc('DICESONICE.Save', 'Configurações salvas.'), 'success');
    } catch (err) {
      console.error('[dice-so-nice] save error:', err);
    }
  }

  onAction(action) {
    if (action === 'save') {
      return this._save();
    } else if (action === 'cancel') {
      this.close();
    } else if (action === 'dsn-reset') {
      saveJSON(LS_OPTIONS, { ...DEFAULT_OPTIONS });
      saveJSON(LS_APPEARANCE, {});
      this.rerenderBody();
      setTimeout(() => this._buildPreview(), 100);
    }
  }
}

LoomHooks.on('init', () => {
  // Só o menu (botão que abre a DiceConfigWindow). options/appearance vão
  // para localStorage direto — ver comentário em LS_OPTIONS.
  settings.registerMenu(MODULE, 'dice-so-nice', {
    name: 'Dice So Nice!',
    label: 'Dice So Nice!',
    hint: 'Configure the 3D dice.',
    icon: '🎲',
    type: DiceConfigWindow,
  });
});

LoomHooks.on('ready', () => {
  window.Loom.dice3d = new Dice3D();
});

LoomHooks.on('chat.roll', (roll) => {
  const d3d = window.Loom?.dice3d;
  if (!d3d || !d3d.isEnabled()) return;
  if (!roll || roll.mode !== 'public') return;
  d3d.showForRoll(roll, window.Loom?.user ?? null).catch((err) => {
    console.error('[dice-so-nice] showForRoll failed:', err);
  });
});

console.log('[dice-so-nice] addon loaded');
