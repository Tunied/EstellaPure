"""Native (QuickJS) binding generator — the native sibling of the embind generator.

Emits, per ES_COMPONENT, QuickJS-callable member getters/setters for reflected
strings, scalars, vectors and enums, plus compiler-validated zero-copy buffers and an
``esn_register()`` that installs them as script globals. It consumes the SAME
parsed reflection (data.Component) as EmbindGenerator, so the web (embind) and
native (QuickJS) binding surfaces are generated from one source and cannot drift.

Opt-in: only emitted when ``python -m eht --native-output PATH`` is given, so the
default EHT run (and the committed *.generated.* files it produces) is unchanged.
The generated TU relies on a host-provided shim header (default ``esn_shim.hpp``)
for the ``esn_*`` readers, the entity lookup, and the component includes.
"""

from typing import List
from ..data import Component, Enum, READ_HOOKS, WRITE_HOOKS
from ..type_system import TypeSystem
from .ptr_layout import PtrLayoutGenerator

# Numeric primitives written straight through (via a double), by cleaned type.
_FLOAT = {'f32', 'f64', 'float', 'double'}
_INT = {'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
        'int', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'size_t', 'char'}
# Float vector arities used by list element bindings.
_GLM_ARITY = {'glm::vec2': 2, 'glm::vec3': 3, 'glm::vec4': 4}


class NativeBindingsGenerator:
    def __init__(self, components: List[Component], enums: List[Enum],
                 shim_header: str = 'esn_shim.hpp', only=None):
        # ``only`` (a set of component names) narrows the emitted surface so a host
        # that includes only some component headers still compiles; None = all.
        self.components = [c for c in components if only is None or c.name in only]
        self.enums = enums
        self.types = TypeSystem(enums)
        self.shim_header = shim_header
        self.layouts = {l['name']: l for l in PtrLayoutGenerator(self.components, enums).layouts}

    def _members(self, ct):
        if ct in self.types.CUSTOM_STRUCTS:
            return [m for m, _ in self.types.CUSTOM_STRUCTS[ct]]
        if ct in self.types.GLM_TYPES:
            return ['x', 'y', 'z', 'w'][:{'glm::vec2': 2, 'glm::uvec2': 2,
                                       'glm::vec3': 3}.get(ct, 4)]
        return []

    def _read_field(self, prop):
        ct = self.types.clean_type(prop.cpp_type)
        n = prop.name
        members = self._members(ct)
        if members:
            lines = ['    { JSValue v = JS_NewObject(ctx);']
            lines += [f'      JS_SetPropertyStr(ctx, v, "{m}", JS_NewFloat64(ctx, c->{n}.{m}));'
                      for m in members]
            return lines + [f'      JS_SetPropertyStr(ctx, o, "{n}", v); }}']
        if ct == 'std::string':
            value = f'JS_NewStringLen(ctx, c->{n}.data(), c->{n}.size())'
        elif ct == 'bool':
            value = f'JS_NewBool(ctx, c->{n})'
        elif self.types.is_handle(ct):
            value = f'JS_NewFloat64(ctx, c->{n}.id())'
        elif ct == 'Entity':
            value = f'JS_NewFloat64(ctx, static_cast<esengine::u32>(c->{n}))'
        elif ct in _FLOAT | _INT or self.types.is_enum(ct):
            value = f'JS_NewFloat64(ctx, static_cast<double>(c->{n}))'
        else:
            return []
        return [f'    JS_SetPropertyStr(ctx, o, "{n}", {value});']

    def _field(self, prop) -> str:
        t = prop.cpp_type
        n = prop.name
        ct = self.types.clean_type(t)
        if ct == 'std::string':
            return (f'    {{ JSValue v = JS_GetPropertyStr(ctx, o, "{n}"); '
                    'if (!JS_IsUndefined(v)) { size_t len; const char* s = JS_ToCStringLen(ctx, &len, v); '
                    f'if (s) {{ c.{n}.assign(s, len); JS_FreeCString(ctx, s); }} }} '
                    'JS_FreeValue(ctx, v); }')
        if self._members(ct):
            lines = [f'    {{ JSValue v = JS_GetPropertyStr(ctx, o, "{n}");']
            lines.append('      if (JS_IsObject(v)) {')
            for i, m in enumerate(self._members(ct)):
                lines.append(f'      {{ double x; if (esn_getnum(ctx, v, JS_IsArray(v) ? "{i}" : "{m}", &x)) '
                             f'c.{n}.{m} = static_cast<decltype(c.{n}.{m})>(x); }}')
            return '\n'.join(lines + ['      } JS_FreeValue(ctx, v); }'])
        if ct == 'bool':
            return f'    {{ int _b; if (esn_getbool(ctx, o, "{n}", &_b)) c.{n} = _b != 0; }}'
        if self.types.is_enum(t) or ct in _INT or ct == 'Entity':
            return (f'    {{ double _v; if (esn_getnum(ctx, o, "{n}", &_v)) '
                    f'c.{n} = static_cast<decltype(c.{n})>(static_cast<long long>(_v)); }}')
        if ct in _FLOAT:
            return (f'    {{ double _v; if (esn_getnum(ctx, o, "{n}", &_v)) '
                    f'c.{n} = static_cast<decltype(c.{n})>(_v); }}')
        if self.types.is_handle(t):
            # A resource handle (e.g. TextureHandle): the script passes the packed
            # id returned by a resource binding (es_createTexture); reconstruct it.
            return (f'    {{ double _v; if (esn_getnum(ctx, o, "{n}", &_v)) '
                    f'c.{n} = decltype(c.{n})(static_cast<esengine::u32>(static_cast<long long>(_v))); }}')
        if self.types.is_struct_vector(ct):
            return f'    // {n}: a list, carried by its own _set/_get pair'
        return f'    // skip {n}: {t} (entity / vector / struct — needs a bespoke binding)'


    def _list_fields(self, comp):
        """(property, [member names]) for every field carried as a JS array.

        A variable-length field has no place in the zero-copy component buffer the
        ptr accessors write through — its storage is a pointer — so it crosses as
        its own pair of bindings. Entity lists predate this and keep the
        hand-written pair the registry wires them by (MeshSkin, Children).
        """
        out = []
        for prop in comp.properties:
            t = self.types.clean_type(prop.cpp_type)
            # A list of plain numbers crosses as a list of numbers: no members to
            # walk, which is what the empty list below means downstream.
            if t in self.types.VECTOR_TYPES and 'entity_ref' not in prop.annotations:
                out.append((prop, []))
                continue
            if not self.types.is_struct_vector(t):
                continue
            elem = self.types.vector_elem(t)
            members = ([m for m, _ in self.types.CUSTOM_STRUCTS[elem]]
                       if elem in self.types.CUSTOM_STRUCTS
                       else ['x', 'y', 'z', 'w'][:_GLM_ARITY[elem]])
            out.append((prop, members))
        return out

    def _list_binding(self, comp, full, prop, members) -> List[str]:
        get_name = f'es_{comp.name}_{prop.name}_get'
        set_name = f'es_{comp.name}_{prop.name}_set'
        out = [f'static JSValue {get_name}(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{',
               '    JSValue arr = JS_NewArray(ctx);',
               '    if (argc < 1) return arr;',
               f'    const auto* c = esn_reg().tryGet<{full}>(esn_entity(ctx, argv[0]));',
               '    if (!c) return arr;',
               '    uint32_t i = 0;',
               f'    for (const auto& v : c->{prop.name}) {{']
        if members:
            out.append('        JSValue o = JS_NewObject(ctx);')
            for m in members:
                out.append(f'        JS_SetPropertyStr(ctx, o, "{m}", JS_NewFloat64(ctx, v.{m}));')
            out.append('        JS_SetPropertyUint32(ctx, arr, i++, o);')
        else:
            out.append('        JS_SetPropertyUint32(ctx, arr, i++, JS_NewFloat64(ctx, v));')
        out += ['    }',
                '    return arr;',
                '}',
                f'static JSValue {set_name}(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{',
                '    if (argc < 2) return JS_UNDEFINED;',
                f'    auto& c = esn_reg().getOrEmplace<{full}>(esn_entity(ctx, argv[0]));',
                f'    c.{prop.name}.clear();',
                '    uint32_t len = 0;',
                '    JSValue lenv = JS_GetPropertyStr(ctx, argv[1], "length");',
                '    JS_ToUint32(ctx, &len, lenv);',
                '    JS_FreeValue(ctx, lenv);',
                f'    c.{prop.name}.reserve(len);',
                '    for (uint32_t i = 0; i < len; ++i) {',
                '        JSValue e = JS_GetPropertyUint32(ctx, argv[1], i);',
                f'        decltype(c.{prop.name})::value_type v{{}};',
                '        double n = 0;']
        if members:
            for m in members:
                out += [f'        {{ JSValue f = JS_GetPropertyStr(ctx, e, "{m}");',
                        f'          if (JS_ToFloat64(ctx, &n, f) == 0) v.{m} = static_cast<decltype(v.{m})>(n);',
                        '          JS_FreeValue(ctx, f); }']
        else:
            out += ['        if (JS_ToFloat64(ctx, &n, e) == 0) v = static_cast<decltype(v)>(n);']
        out += [f'        c.{prop.name}.push_back(v);',
                '        JS_FreeValue(ctx, e);',
                '    }',
                '    return JS_UNDEFINED;',
                '}']
        return out

    def _component(self, comp: Component) -> List[str]:
        full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
        # Per-field setter: es_set_<Component>(entityId, obj).
        out = [f'static JSValue es_set_{comp.name}(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{',
               '    if (argc < 2) return JS_UNDEFINED;',
               '    esengine::Entity e = esn_entity(ctx, argv[0]);',
               f'    auto& c = esn_reg().getOrEmplace<{full}>(e);',
               '    JSValueConst o = argv[1];',
               '    (void)c; (void)o;']
        for prop in comp.properties:
            if 'readonly' not in prop.annotations:
                out.append(self._field(prop))
        if comp.name in WRITE_HOOKS:
            out.append(f'    {WRITE_HOOKS[comp.name]}')
        out.append('    return JS_UNDEFINED;')
        out.append('}')
        out += [f'static JSValue es_get_{comp.name}(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{',
                '    JSValue o = JS_NewObject(ctx);',
                '    if (argc < 1) return o;',
                f'    auto* c = esn_reg().tryGet<{full}>(esn_entity(ctx, argv[0]));',
                '    if (!c) return o;']
        read_hook = READ_HOOKS.get(comp.name)
        if read_hook:
            out.append(f'    c->{read_hook}();')
        for prop in comp.properties:
            out.extend(self._read_field(prop))
        out += ['    return o;', '}']
        # The buffer implementation is registered below only if the native
        # compiler proves trivial ownership and the actual wasm accessor offsets.
        # getOrEmplace so a first write (component add) also creates the component.
        out.append(f'static JSValue es_{comp.name}_buffer(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        out.append('    if (argc < 1) return JS_UNDEFINED;')
        out.append('    esengine::Entity e = esn_entity(ctx, argv[0]);')
        out.append(f'    auto& c = esn_reg().getOrEmplace<{full}>(e);')
        read_hook = READ_HOOKS.get(comp.name)
        if read_hook:
            out.append(f'    c.{read_hook}();   // lazily derived fields, see READ_HOOKS')
        out.append(f'    return esn_arraybuffer(ctx, &c, sizeof({full}));')
        out.append('}')
        # Lifecycle: the native siblings of the embind Registry's has/remove. With
        # the buffer (getOrEmplace = add) + ptrAccessors (fields), these complete the
        # component API the SDK's BuiltinBridge drives (getBuiltinMethods).
        out.append(f'static JSValue es_{comp.name}_has(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        out.append('    if (argc < 1) return JS_UNDEFINED;')
        out.append('    esengine::Entity e = esn_entity(ctx, argv[0]);')
        out.append(f'    return JS_NewBool(ctx, esn_reg().has<{full}>(e));')
        out.append('}')
        out.append(f'static JSValue es_{comp.name}_remove(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        out.append('    if (argc < 1) return JS_UNDEFINED;')
        out.append('    esengine::Entity e = esn_entity(ctx, argv[0]);')
        out.append(f'    if (esn_reg().has<{full}>(e)) esn_reg().remove<{full}>(e);')
        out.append('    return JS_UNDEFINED;')
        out.append('}')
        for prop, members in self._list_fields(comp):
            out.extend(self._list_binding(comp, full, prop, members))
        out.append('')
        return out

    def generate(self) -> str:
        lines = [
            '// Auto-generated by EHT (native_bindings) — DO NOT EDIT.',
            '// Native QuickJS sibling of WebBindings.generated.cpp — one reflection source.',
            f'#include "{self.shim_header}"',
            '#include <type_traits>',
            '#include <cstddef>',
            '',
        ]
        components = sorted(self.components, key=lambda c: c.name)
        if any(c.name in WRITE_HOOKS for c in components):
            lines.append('#include "esengine/ecs/TransformSystem.hpp"')
        # Self-include each bound component's header (relative to src/), so the TU
        # needs only the shim for the esn_* plumbing — deduped (some components
        # share a header, e.g. the collider family).
        seen = set()
        for comp in components:
            hp = comp.header_path.replace('\\', '/')
            if hp.startswith('src/'):
                hp = hp[len('src/'):]
            if hp and hp not in seen:
                seen.add(hp)
                lines.append(f'#include "{hp}"')
        if seen:
            lines.append('')
        for comp in components:
            lines.extend(self._component(comp))
        lines.append('void esn_register(JSContext* ctx, JSValue global) {')
        for comp in components:
            setter = f'es_set_{comp.name}'
            buffer = f'es_{comp.name}_buffer'
            has = f'es_{comp.name}_has'
            remove = f'es_{comp.name}_remove'
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{setter}", '
                         f'JS_NewCFunction(ctx, {setter}, "{setter}", 2));')
            getter = f'es_get_{comp.name}'
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{getter}", '
                         f'JS_NewCFunction(ctx, {getter}, "{getter}", 1));')
            # Expose the raw buffer ONLY when this compiler proves every accessed
            # offset matches wasm32 and no owned string/vector can be overwritten.
            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            layout = self.layouts.get(comp.name)
            if layout:
                checks = [f'std::is_standard_layout_v<{full}>',
                          f'std::is_trivially_copyable_v<{full}>']
                checks += [f'offsetof({full}, {f["name"]}) == {f["offset"]}'
                           for f in layout['fields']]
                for f in layout['fields']:
                    checks += [f'offsetof(decltype({full}::{f["name"]}), {m["name"]}) == {m["offset"]}'
                               for m in f.get('members', [])]
                lines.append(f'    if constexpr ({" && ".join(checks)}) {{')
                lines.append(f'        JS_SetPropertyStr(ctx, global, "{buffer}", '
                             f'JS_NewCFunction(ctx, {buffer}, "{buffer}", 1));')
                lines.append('    }')
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{has}", '
                         f'JS_NewCFunction(ctx, {has}, "{has}", 1));')
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{remove}", '
                         f'JS_NewCFunction(ctx, {remove}, "{remove}", 1));')
            for prop, _members in self._list_fields(comp):
                for fn, arity in ((f'es_{comp.name}_{prop.name}_get', 1),
                                  (f'es_{comp.name}_{prop.name}_set', 2)):
                    lines.append(f'    JS_SetPropertyStr(ctx, global, "{fn}", '
                                 f'JS_NewCFunction(ctx, {fn}, "{fn}", {arity}));')
        lines.append('}')
        lines.append('')
        return '\n'.join(lines)
