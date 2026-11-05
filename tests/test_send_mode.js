// Exercise the public extension's Super+U binding with mocked GNOME APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('extension.js', 'utf8')
  .replace(/^import .*;$/gm, '').replace('export default class', 'class');
const timers = new Map();
const removed = [];
let timerId = 0;
const grab = {get_seat_state: () => 3};
const context = vm.createContext({
  console, Extension: class {},
  Clutter: {GrabState: {ALL: 3}, EventType: {KEY_PRESS: 1, KEY_RELEASE: 2},
    EVENT_STOP: 1, EVENT_PROPAGATE: 0, ModifierType: {SUPER_MASK: 1, MOD4_MASK: 2}, keyval_name: value => value},
  GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
    timeout_add: (_priority, _ms, callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    idle_add: (_priority, callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    source_remove: id => timers.delete(id)},
  Main: {pushModal: () => grab, popModal: value => removed.push(value)},
  Shell: {ActionMode: {NONE: 0}},
  print: () => {}, global: {get_pointer: () => [0, 0, 0], stage: {set_key_focus: () => {}}},
});
vm.runInContext(source, context);
context.state = {active: false, targetWorkspace: null, grab: null};
context.actor = {};
context.settings = {get_strv: () => ['1:<Super>Z']};
vm.runInContext('startWorkspaceSendMode(state, actor)', context);
assert.equal(context.state.active, true);
assert.ok(timers.size, 'a missed release must not trap keyboard input indefinitely');
context.event = {type: () => 2, get_key_symbol: () => 'u'};
vm.runInContext('handleWorkspaceSendModeEvent(event, state, settings)', context);
assert.equal(context.state.active, false, 'releasing U exits send mode');
assert.equal(removed.length, 0, 'do not release a grab during event dispatch');
for (const callback of [...timers.values()]) callback();
assert.equal(removed.length, 1, 'release the modal grab after event dispatch');
console.log('send-mode regression passed');

// A lost key-release is recovered as soon as Super is no longer held.
removed.length = 0;
timers.clear();
context.state = {active: false, targetWorkspace: null, grab: null};
vm.runInContext('startWorkspaceSendMode(state, actor)', context);
const watchdog = [...timers.values()][0];
watchdog();
assert.equal(context.state.active, false, 'lost release must end the mode');
assert.equal(removed.length, 1, 'lost release must release the grab');

// A selected workspace stays usable while Super remains held.
removed.length = 0;
timers.clear();
context.global.get_pointer = () => [0, 0, 1];
context.state = {active: false, targetWorkspace: null, grab: null};
vm.runInContext('startWorkspaceSendMode(state, actor)', context);
context.event = {type: () => 1, get_key_symbol: () => 'z'};
vm.runInContext('handleWorkspaceSendModeEvent(event, state, settings)', context);
assert.equal(context.state.targetWorkspace, 0);
[...timers.values()][0]();
assert.equal(context.state.active, true);
assert.equal(removed.length, 0);
vm.runInContext('stopWorkspaceSendMode(state)', context);
assert.equal(removed.length, 1);
