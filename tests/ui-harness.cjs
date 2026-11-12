// Real React components/hooks with native surfaces replaced by small test doubles.
// This exercises callback wiring and rendering, not OS gesture recognition.
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname, extname, basename } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const TestRenderer = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class TestGesture {
  constructor(kind, gestures = []) { this.kind = kind; this.gestures = gestures; this.config = {}; this.callbacks = {}; }
}
for (const name of ['enabled', 'minDistance', 'maxDistance', 'maxPointers', 'numberOfPointers', 'runOnJS', 'blocksExternalGesture', 'activateAfterLongPress', 'minDuration', 'maxDuration']) {
  TestGesture.prototype[name] = function (...values) { this.config[name] = values.length === 1 ? values[0] : values; return this; };
}
for (const name of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
  TestGesture.prototype[name] = function (callback) { this.callbacks[name] = callback; return this; };
}

function createUiHarness({ calendar, repository, routeParams = {}, safeAreaInsets = { top: 44, bottom: 34, left: 0, right: 0 } } = {}) {
  const cache = new Map();
  const animations = [], sharedValues = [], navigation = [], haptics = [], focusCleanups = new Set();
  const View = React.forwardRef(function NativeView(props, ref) {
    React.useImperativeHandle(ref, () => ({ measureInWindow: callback => callback(80, 240, 100, 88), scrollTo: () => {} }), []);
    return React.createElement('View', props, props.children);
  });
  const native = {
    View, ScrollView: View, KeyboardAvoidingView: View, Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', Modal: 'Modal', ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: value => value, hairlineWidth: 0.5, absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }), Platform: { OS: 'ios' },
  };
  const TabContext = React.createContext(null);
  function Tabs({ children, ...props }) {
    const [selected, setSelected] = React.useState('calendar');
    return React.createElement(TabContext.Provider, { value: { selected, setSelected } }, React.createElement('Tabs', props, children));
  }
  function TabTrigger({ name, href, children }) {
    const { selected, setSelected } = React.useContext(TabContext);
    return React.createElement('TabTrigger', { name, href }, React.cloneElement(children, { isFocused: selected === name, onPress: () => setSelected(name) }));
  }
  const mocks = {
    'react-native': native,
    'react-native-gesture-handler': {
      GestureDetector: 'GestureDetector',
      Gesture: Object.fromEntries(['Pan', 'LongPress', 'Tap', 'Native', 'Simultaneous', 'Exclusive'].map(kind => [kind, (...gestures) => new TestGesture(kind, gestures)])),
    },
    'react-native-reanimated': {
      __esModule: true, default: { View },
      useSharedValue: value => React.useMemo(() => { const shared = { value, set(next) { this.value = next; }, get() { return this.value; } }; sharedValues.push(shared); return shared; }, []),
      useAnimatedStyle: callback => callback(), withSpring: value => { animations.push({ kind: 'spring', value }); return value; },
      withTiming: value => { animations.push({ kind: 'timing', value }); return value; }, cancelAnimation: () => {},
    },
    'react-native-safe-area-context': { SafeAreaView: View, useSafeAreaInsets: () => safeAreaInsets },
    'expo-router/ui': { Tabs, TabList: View, TabSlot: 'TabSlot', TabTrigger },
    'expo-router': {
      useLocalSearchParams: () => routeParams,
      router: Object.fromEntries(['push', 'replace', 'back'].map(method => [method, (...args) => navigation.push({ method, args })])),
      useFocusEffect: callback => React.useEffect(() => { const cleanup = callback(); if (cleanup) focusCleanups.add(cleanup); return () => { focusCleanups.delete(cleanup); cleanup?.(); }; }, [callback]),
    },
    '@/lib/haptics': { selectionHaptic: () => haptics.push('selection'), rejectionHaptic: () => haptics.push('rejection') },
    '@/lib/database': { getRepository: async () => repository },
    ...(calendar ? { '@/hooks/use-calendar': { useCalendar: () => calendar } } : {}),
  };
  const project = resolve(__dirname, '..');
  function load(filename) {
    let path = resolve(project, filename);
    if (!extname(path)) path += existsSync(`${path}.tsx`) ? '.tsx' : '.ts';
    if (dirname(path) === resolve(project, 'src/lib') && ['dates', 'timetable', 'timetable-press', 'context-menu'].includes(basename(path, '.ts'))) {
      return require(resolve(project, '.test-build/lib', basename(path, '.ts')));
    }
    if (cache.has(path)) return cache.get(path).exports;
    const instance = new Module(path, module);
    instance.filename = path;
    instance.paths = Module._nodeModulePaths(dirname(path));
    cache.set(path, instance);
    const originalRequire = instance.require.bind(instance);
    instance.require = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}`);
      if (name.startsWith('.')) return load(resolve(dirname(path), name));
      return originalRequire(name);
    };
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: path,
    }).outputText;
    instance._compile(compiled, path);
    return instance.exports;
  }
  return { React, TestRenderer, load, animations, sharedValues, navigation, haptics, blur: () => { for (const cleanup of focusCleanups) cleanup(); } };
}

module.exports = { createUiHarness };
