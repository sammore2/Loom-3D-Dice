"use strict";

// ──────────────────────────────────────────
// DiceNotation — LoomVTT native, dual-format.
//
// Aceita os DOIS formatos de roll:
// 1. Loom RollResult: { terms: [{kind:'dice',count,faces,rolls[],dropped[]}
//                               | {kind:'modifier',value}], ... }
//    (o que chega no hook `chat.roll`)
// 2. Roll estilo Foundry: { dice: [{faces,number,modifiers,
//    options,results:[{result,exploded}], constructor}] }
//    (o que sistemas convertidos como wod5e passam direto para
//    `showForRoll` — ver system/scripts/system-rolls.js)
//
// Produz: { throws: [{ dice: [{result,resultLabel,type,vectors,options}] }] }
// ──────────────────────────────────────────

const SUPPORTED_FACES = [2, 3, 4, 5, 6, 8, 10, 12, 20, 100];

function cloneOptions(options) {
  if (!options || typeof options !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(options));
  } catch {
    return { ...options };
  }
}

export class DiceNotation {
  constructor(roll, maxDiceNumber = 20) {
    this.throws = [{ dice: [] }];
    if (!roll) return;
    if (Array.isArray(roll.terms)) this._fromLoomTerms(roll, maxDiceNumber);
    else if (Array.isArray(roll.dice)) this._fromFoundryDice(roll, maxDiceNumber);
  }

  // ── Formato 1: Loom RollResult ──
  _fromLoomTerms(roll, maxDiceNumber) {
    let diceNumber = 0;
    for (const term of roll.terms) {
      if (!term || term.kind !== 'dice') continue;
      // Dado custom (ex: wod5e HungerDie com DENOMINATION='g' em objeto
      // vivo): preserva o tipo em vez de achatar para d10.
      const denom = term.constructor && term.constructor.DENOMINATION;
      if (denom && denom !== 'd' && denom !== 'D') {
        if (!SUPPORTED_FACES.includes(term.faces)) continue;
        const rolls = Array.isArray(term.rolls) ? term.rolls : [];
        for (let i = 0; i < rolls.length; i++) {
          if (term.dropped && term.dropped[i]) continue;
          if (++diceNumber > maxDiceNumber) return;
          this._addFoundryDie(this._loomTermAsFoundry(term), i);
        }
        continue;
      }
      if (!SUPPORTED_FACES.includes(term.faces)) continue;
      const rolls = Array.isArray(term.rolls) ? term.rolls : [];
      for (let i = 0; i < rolls.length; i++) {
        if (term.dropped && term.dropped[i]) continue;
        if (++diceNumber > maxDiceNumber) return;
        this._addLoomDie(term, i);
        if (term.faces === 100) this._addLoomDie(term, i, true);
      }
    }
  }

  // Adapta um termo Loom com DENOMINATION custom para o formato Foundry
  // (results + constructor) reaproveitando _addFoundryDie.
  _loomTermAsFoundry(term) {
    const ctor = term.constructor ?? {};
    return {
      faces: term.faces,
      number: term.count ?? term.number ?? (term.rolls ? term.rolls.length : 0),
      options: term.options ?? {},
      results: Array.isArray(term.results) && term.results.length
        ? term.results
        : (term.rolls || []).map((r) => ({ result: r })),
      constructor: {
        name: ctor.name ?? 'Die',
        DENOMINATION: ctor.DENOMINATION ?? 'd',
        getResultLabel: typeof ctor.getResultLabel === 'function'
          ? ctor.getResultLabel.bind(ctor)
          : undefined,
      },
    };
  }

  _addLoomDie(loomTerm, index, isd10of100 = false) {
    const dsnDie = {};
    let dieValue = loomTerm.rolls[index];
    if (loomTerm.faces === 100) {
      if (isd10of100) {
        dieValue = dieValue % 10;
        dsnDie.resultLabel = String(dieValue);
      } else {
        dieValue = parseInt(dieValue / 10, 10);
        dsnDie.resultLabel = String(dieValue * 10);
        if (dieValue === 10) dieValue = 0;
      }
    } else {
      dsnDie.resultLabel = String(dieValue);
    }
    dsnDie.result = dieValue;
    dsnDie.type = isd10of100 ? 'd10' : 'd' + loomTerm.faces;
    dsnDie.vectors = [];
    dsnDie.options = {
      flavor: loomTerm.flavor,
      modifier: loomTerm.modifier,
    };
    this.throws[0].dice.push(dsnDie);
  }

  // ── Formato 2: Roll estilo Foundry (wod5e e sistemas convertidos) ──
  _fromFoundryDice(rolls, maxDiceNumber) {
    rolls.dice.forEach((die) => {
      if (!die || !SUPPORTED_FACES.includes(die.faces)) return;
      if (!Array.isArray(die.results)) return;
      let cnt = die.number ?? die.results.length;
      let countExploded = 0;
      let localNbThrow = 0;
      for (let i = 0; i < die.results.length; i++) {
        if (localNbThrow >= this.throws.length) this.throws.push({ dice: [] });
        if (die.results[i].exploded) countExploded++;
        die.results[i].indexThrow = localNbThrow;
        if (--cnt <= 0) {
          localNbThrow++;
          cnt = countExploded;
          countExploded = 0;
        }
      }
    });
    let diceNumber = 0;
    rolls.dice.some((die) => {
      if (!die || !SUPPORTED_FACES.includes(die.faces)) return false;
      if (!Array.isArray(die.results)) return false;
      for (let i = 0; i < die.results.length; i++) {
        if (++diceNumber > maxDiceNumber) return true;
        this._addFoundryDie(die, i);
        if (die.faces === 100) this._addFoundryDie(die, i, true);
      }
      return false;
    });
  }

  _addFoundryDie(fvttDie, index, isd10of100 = false) {
    const dsnDie = {};
    const ctor = fvttDie.constructor ?? {};
    const labelOf = typeof ctor.getResultLabel === 'function'
      ? (v) => String(ctor.getResultLabel(v))
      : (v) => String(v);
    let dieValue = fvttDie.results[index].result;
    if (fvttDie.faces === 100) {
      if (isd10of100) {
        dieValue = dieValue % 10;
        dsnDie.resultLabel = labelOf(dieValue);
      } else {
        dieValue = parseInt(dieValue / 10, 10);
        dsnDie.resultLabel = labelOf(dieValue * 10);
        if (dieValue === 10) dieValue = 0;
      }
    } else {
      dsnDie.resultLabel = labelOf(dieValue);
    }
    dsnDie.result = dieValue;

    dsnDie.type = ctor.DENOMINATION ?? 'd';
    if (ctor.name === 'Die' || !ctor.name) dsnDie.type += isd10of100 ? '10' : fvttDie.faces;
    else dsnDie.type = 'd' + dsnDie.type;
    dsnDie.vectors = [];
    dsnDie.options = cloneOptions(fvttDie.options);
    const bucket = fvttDie.results[index].indexThrow ?? 0;
    this.throws[bucket].dice.push(dsnDie);
  }

  static mergeQueuedRollCommands(queue) {
    const mergedRollCommands = [];
    queue.forEach((command) => {
      for (let i = 0; i < command.params.throws.length; i++) {
        if (!mergedRollCommands[i]) mergedRollCommands.push([]);
        command.params.throws[i].dsnConfig = command.params.dsnConfig;
        mergedRollCommands[i].push(command.params.throws[i]);
      }
    });
    return mergedRollCommands;
  }
}
