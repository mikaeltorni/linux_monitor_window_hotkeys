// Headless regression for explicit-window placement; no GNOME or GUI is opened.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('extension.js', 'utf8').replace(/^import .*;$/gm, '').replace('export default class', 'class');
const events = [];
const target = {
  is_skip_taskbar: () => false,
  get_description: () => "0x2a",
  move_to_monitor: n => events.push(['monitor', n]),
  get_monitor: () => 0,
  get_work_area_for_monitor: () => ({x: 100, y: 20, width: 1000, height: 800}),
  move_resize_frame: (...args) => events.push(['rect', ...args]),
  raise_and_make_recent: () => { throw Error('background action raised window'); },
};
const context = vm.createContext({console, Extension: class {}, Meta: {MaximizeFlags: {BOTH: 3}},
  global: {display: {get_n_monitors: () => 2, focus_window: null},
    get_window_actors: () => [{get_meta_window: () => target}]}});
vm.runInContext(source, context);
for (const id of ['42', '0x2a']) {
  context.id = id;
  vm.runInContext("performWindowAction(id, 'MoveToMonitor2')", context);
}
assert.deepEqual(events, [['monitor', 1], ['monitor', 1]]);
events.length = 0;
vm.runInContext("performWindowAction('42', 'TileRightHalf')", context);
assert.deepEqual(events.at(-1), ['rect', true, 600, 20, 500, 800]);
for (const [id, action] of [['99', 'MoveToMonitor2'], ['bad', 'TileRightHalf'], ['42', 'Bogus'], ['42', 'MoveToMonitor6']]) {
  context.id = id; context.action = action;
  assert.throws(() => vm.runInContext('performWindowAction(id, action)', context));
}

for (const edge of ['Left', 'Right', 'Top', 'Bottom']) {
  context.action = `Tile${edge}Half`;
  vm.runInContext("performWindowAction('42', action)", context);
}

// Legacy hotkeys still use the focused window and raise after tiling.
context.global.display.focus_window = target;
target.raise_and_make_recent = () => events.push(['raise']);
vm.runInContext('tileFocusedWindowRightHalf()', context);
assert.deepEqual(events.at(-1), ['raise']);
