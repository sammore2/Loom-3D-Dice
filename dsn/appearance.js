// dsn/appearance.js — helpers puros da janela de config (tema + faces).
// ESM, sem dependência de Foundry nem DOM. Importa só ./DiceColors.js;
// a factory (DiceFactory) vem por parâmetro para evitar ciclo de import.
import { COLORSETS, DiceColors } from './DiceColors.js';

/**
 * Agrupa os colorsets por categoria: { [categoria]: { [name]: descricao } }.
 * Entradas dentro de cada grupo ordenadas por descrição; categorias
 * ordenadas alfabeticamente (determinístico). Se categoria/descrição
 * ausentes, usa o próprio name. Respeita DiceColors.colorsetForced
 * (quando setado, retorna só ele).
 */
export function getColorsetGroups() {
	const forced = DiceColors?.colorsetForced;
	if (forced) {
		const data = COLORSETS[forced];
		if (data) {
			const category = data.category || forced;
			const description = data.description || forced;
			return { [category]: { [forced]: description } };
		}
		return { [forced]: { [forced]: forced } };
	}
	const entries = Object.entries(COLORSETS).sort(([nameA, a], [nameB, b]) => {
		const da = String(a?.description ?? nameA);
		const db = String(b?.description ?? nameB);
		return da.localeCompare(db);
	});
	const groups = {};
	for (const [name, data] of entries) {
		const category = data?.category || name;
		const description = data?.description || name;
		if (!groups[category]) groups[category] = {};
		groups[category][name] = description;
	}
	const ordered = {};
	for (const category of Object.keys(groups).sort((x, y) => x.localeCompare(y))) {
		ordered[category] = groups[category];
	}
	return ordered;
}

/**
 * Lista os sistemas de faces da factory: [{ id, name }].
 * Respeita factory.systemForced (quando forçado, retorna só o ativo).
 */
export function getSystemList(factory) {
	if (!factory || typeof factory.systems !== 'object' || factory.systems === null) return [];
	return Object.values(factory.systems).map((s) => ({ id: s.id, name: s.name ?? s.id }));
}

/** true se for o colorset 'custom' ou um colorset inexistente. */
export function isCustomColorset(name) {
	return name === 'custom' || !Object.prototype.hasOwnProperty.call(COLORSETS, name);
}

/** Contraste preto/branco por luminância (mesma fórmula do contrastOf em client.js). */
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

/** Aparência padrão para uma cor base (colorset custom, sistema standard). */
export function defaultAppearanceFor(color) {
	return {
		labelColor: contrastOf(color),
		diceColor: color,
		outlineColor: color,
		edgeColor: color,
		texture: 'none',
		material: 'auto',
		colorset: 'custom',
		system: 'standard'
	};
}
