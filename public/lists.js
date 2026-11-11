// Settings > Lists: institutions, owners, categories and their optional sub-categories.
import { h, get, post, patch, del, money, dialog, emptyState, render } from './app.js';

const txt = (label, id, value = '') => { const i = h('input', { id, value, autocomplete: 'off' }); return [h('label', { for: id }, label), i, i]; };
const noun = (n, s, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

function renameDialog(title, current, run) {
  dialog(title, (close) => {
    const [lab, input] = txt('New name', 'rn', current); const err = h('p', { class: 'form-error', role: 'alert' });
    return h('form', { onsubmit: async (e) => { e.preventDefault(); try { await run(input.value); close(); render(); } catch (x) { err.textContent = x.message; } } },
      h('div', { class: 'field' }, lab, input), err, h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary' }, 'Rename')));
  });
}
// Removing something that is in use always asks what should happen to what uses it.
function removeDialog({ title, message, choices, leaveLabel, run, danger = 'Remove' }) {
  dialog(title, (close) => {
    const sel = h('select', { id: 'mv', 'aria-label': 'Move to' }, h('option', { value: '' }, leaveLabel), choices.map((c) => h('option', { value: c.value }, c.label)));
    const err = h('p', { class: 'form-error', role: 'alert' });
    return h('form', { onsubmit: async (e) => { e.preventDefault(); try { await run(sel.value === '' ? null : sel.value); close(); render(); } catch (x) { err.textContent = x.message; } } },
      h('p', {}, message), h('div', { class: 'field' }, h('label', { for: 'mv' }, 'What should happen to them?'), sel), err,
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn danger' }, danger)));
  });
}

function valueList(title, list, key) {
  return h('section', { class: 'card' }, h('h2', {}, title),
    list.length ? h('ul', { class: 'list' }, list.map((v) => h('li', {}, h('div', { class: 'grow' }, h('span', { class: 'title' }, v.value), ' ', h('span', { class: 'muted small' }, noun(v.count, 'account'))),
      h('button', { class: 'btn small', onclick: () => renameDialog(`Rename ${v.value}`, v.value, (to) => post(`/api/lists/${key}/rename`, { from: v.value, to })) }, 'Rename'),
      h('button', { class: 'btn small danger', onclick: () => removeDialog({ title: `Remove ${v.value}`, message: `${noun(v.count, 'account')} use${v.count === 1 ? 's' : ''} this ${key}.`, leaveLabel: `Leave the ${key} empty`,
        choices: list.filter((x) => x.value !== v.value).map((x) => ({ value: x.value, label: `Move to ${x.value}` })), run: (to) => post(`/api/lists/${key}/remove`, { value: v.value, move_to: to }) }) }, 'Remove')))) :
      h('p', { class: 'muted' }, `No ${key}s yet. They appear here after you add accounts.`));
}

function subRow(c, s, groups) {
  const grp = h('select', { 'aria-label': `Cash flow group for ${s.name}`, onchange: async () => { await patch(`/api/subcategories/${s.id}`, { flow_group: grp.value || null }); } },
    h('option', { value: '' }, 'Same as category'), Object.entries(groups).map(([k, l]) => h('option', { value: k, selected: s.flow_group === k }, l)));
  return h('li', {}, h('div', { class: 'grow' }, h('span', { class: 'title' }, s.name), ' ', h('span', { class: 'muted small' }, noun(s.count, 'transaction'))), grp,
    h('button', { class: 'btn small', onclick: () => renameDialog(`Rename ${s.name}`, s.name, (name) => patch(`/api/subcategories/${s.id}`, { name })) }, 'Rename'),
    h('button', { class: 'btn small danger', onclick: () => removeDialog({ title: `Remove ${s.name}`, message: `${noun(s.count, 'transaction')} use this sub-category.`, leaveLabel: `Keep them on ${c.name} only`,
      choices: c.subs.filter((x) => x.id !== s.id).map((x) => ({ value: x.id, label: `Move to ${x.name}` })), run: (to) => del(`/api/subcategories/${s.id}`, { move_to: to }) }) }, 'Remove'));
}

function categoryBlock(c, categories, groups) {
  const add = h('input', { id: `sub-${c.id}`, placeholder: 'New sub-category', 'aria-label': `New sub-category of ${c.name}` }); const err = h('p', { class: 'form-error', role: 'alert' });
  return h('details', { class: 'card' }, h('summary', {}, h('span', { class: 'title' }, c.name), ' ', h('span', { class: 'pill' }, c.kind), ' ', h('span', { class: 'muted small' }, `${noun(c.count, 'transaction')}${c.subs.length ? `, ${noun(c.subs.length, 'sub-category', 'sub-categories')}` : ''}`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => renameDialog(`Rename ${c.name}`, c.name, (name) => patch(`/api/categories/${c.id}`, { name })) }, 'Rename'),
      h('button', { class: 'btn small danger', onclick: () => removeDialog({ title: `Delete ${c.name}`, message: `${noun(c.count, 'transaction')} and ${noun(c.rules, 'rule')} use this category. Its sub-categories are deleted with it.`, leaveLabel: 'Leave them uncategorised (rules are deleted)',
        choices: categories.filter((x) => x.id !== c.id && !x.archived).map((x) => ({ value: x.id, label: `Move to ${x.name}` })), run: (to) => del(`/api/categories/${c.id}`, { move_to: to }), danger: 'Delete category' }) }, 'Delete')),
    c.subs.length ? h('ul', { class: 'list' }, c.subs.map((s) => subRow(c, s, groups))) : h('p', { class: 'muted small' }, 'No sub-categories. They are optional; transactions can stay on the category.'),
    h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); try { await post('/api/subcategories', { category_id: c.id, name: add.value }); render(); } catch (x) { err.textContent = x.message; } } },
      h('div', { class: 'grow' }, add), h('button', { class: 'btn primary' }, 'Add')), err,
    c.suggested.length ? h('div', {}, h('p', { class: 'muted small' }, `Suggested: ${c.suggested.join(', ')}`),
      h('button', { class: 'btn small', onclick: async () => { await post(`/api/categories/${c.id}/suggested`); render(); } }, `Add the ${c.suggested.length} suggested`)) : null);
}

export async function listsView() {
  const l = await get('/api/lists');
  return h('div', {}, h('p', { class: 'muted' }, 'Institutions and owners come from your accounts. Categories come with the app; sub-categories are yours and always optional. Anything in use asks what to do with it before it is removed.'),
    h('div', { class: 'grid two' }, valueList('Institutions', l.institutions, 'institution'), valueList('Owners', l.owners, 'owner')),
    h('h2', {}, 'Categories and sub-categories'), l.categories.length ? l.categories.map((c) => categoryBlock(c, l.categories, l.groups)) : emptyState('No categories', ''));
}
