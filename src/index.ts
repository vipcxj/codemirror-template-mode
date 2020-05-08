import CodeMirror, { EditorConfiguration, Mode, StringStream } from 'codemirror';
import cloneDeep from 'clonedeep';

declare module 'codemirror' {
    function copyState<T = any>(mode: any, state: T): T;
}

export type PatternLike = RegExp | string | ((text: string, from: number, state: ITemplateState) => [number, string | null]);

export interface IPattern {
    mode: any;
    open?: PatternLike;
    close?: PatternLike;
    escape?: PatternLike;
    children?: IPattern[];
    includePattern?: boolean;
    patternStyles?: [string | null, string | null];
}

export type Callback = (state: ITemplateState, info: { line: string, pos: number, textBefore: string, matched: string | null, pattern: IPattern | null }) => void;

export interface ITemplateOptions extends IPattern {
    name: 'cxj-template';
    codeMode: any;
    beforeEnter?: Callback;
    afterEnter?: Callback;
    beforeExit?: Callback;
    afterExit?: Callback;
}

export interface IPatternContext {
    pre: IPatternContext | null;
    pattern: IPattern;
}

export interface IStateContext {
    pre: IStateContext | null;
    mode: Mode<any>;
    state: any;
}

export interface ITemplateState {
    textBefore: string;
    patternContext: IPatternContext;
    stateContext: IStateContext | null;
    useRoot: boolean;
    start: boolean;
    layers?: ILayer[];
    regExpCache: {
        [source: string]: RegExp;
    };
    customs: {
        [key: string]: any;
    };
}

function pushPatternContext(state: ITemplateState, pattern: IPattern) {
    state.patternContext = {
        pre: state.patternContext,
        pattern,
    };
}

function popPatternContext(state: ITemplateState) {
    state.patternContext = state.patternContext.pre!;
}

function pushStateContext(config: EditorConfiguration, state: ITemplateState, mode: any, stream?: StringStream) {
    const modeObj = CodeMirror.getMode(config, mode);
    const context: IStateContext = {
        pre: null,
        mode: modeObj,
        state: CodeMirror.startState(modeObj, stream && stream.indentation()),
    };
    if (state.stateContext) {
        context.pre = state.stateContext;
    }
    state.stateContext = context;
}

function popStateContext(state: ITemplateState) {
    state.stateContext = state.stateContext!.pre;
}

function getLocalMode(state: ITemplateState): Mode<any> | null {
    return state.stateContext && state.stateContext.mode || null;
}

function getLocalState(state: ITemplateState) {
    return state.stateContext && state.stateContext.state || null;
}

function getCurrentPattern(state: ITemplateState) {
    const { patternContext } = state;
    return patternContext!.pattern;
}

enum AnchorMode {
    NONE,
    START,
    END,
    ALL,
}

function makeSureAnchor(source: string, start: boolean, exist: boolean) {
    if (start) {
        if (exist && !source.startsWith('^')) {
            return `^${source}`;
        } else if (!exist && source.startsWith('^')) {
            return source.slice(1);
        }
    } else {
        if (exist && !source.endsWith('$')) {
            return `${source}$`;
        } else if (!exist && source.endsWith('$')) {
            return source.slice(0, -1);
        }
    }
    return source;
}

function getCachedRegExp(state: ITemplateState, regExp: RegExp, anchor: AnchorMode, global: boolean) {
    let { source, flags } = regExp;
    switch (anchor) {
        case AnchorMode.ALL:
            source = makeSureAnchor(source, true, true);
            source = makeSureAnchor(source, false, true);
            break;
        case AnchorMode.END:
            source = makeSureAnchor(source, true, false);
            source = makeSureAnchor(source, false, true);
            break;
        case AnchorMode.NONE:
            source = makeSureAnchor(source, true, false);
            source = makeSureAnchor(source, false, false);
            break;
        case AnchorMode.START:
            source = makeSureAnchor(source, true, true);
            source = makeSureAnchor(source, false, false);
    }
    if (global && flags.indexOf('g') === -1) {
        flags = `${flags}g`;
    } else if (!global && flags.indexOf('g') !== -1) {
        flags = flags.replace(/g/g, '');
    }
    const key = `${source}tVes#aE$${flags}`;
    let cached = state.regExpCache[key];
    if (!cached) {
        cached = new RegExp(source, flags);
        state.regExpCache[key] = cached;
    }
    return cached;
}

enum MatchMode {
    DEFAULT,
    PREFIX,
}

const REG_SPACE = /^\s*$/;
const REG_WORD = /\w/;

function match(line: string, position: number, mode: MatchMode, pattern: PatternLike, state: ITemplateState): [number, string | null] {
    if (typeof pattern === 'string') {
        if (mode === MatchMode.DEFAULT) {
            const index = line.indexOf(pattern, position);
            return [index, index >= 0 ? pattern : null];
        } else {
            return line.endsWith(pattern, position) ? [position - pattern.length, pattern] : [-1, null];
        }
    }
    if (typeof pattern === 'function') {
        return pattern(line, position, state);
    }
    if (mode === MatchMode.DEFAULT) {
        const reg = getCachedRegExp(state, pattern, AnchorMode.NONE, true);
        reg.lastIndex = position;
        const result = reg.exec(line);
        return result ? [result.index, result[0]] : [-1, null];
    } else {
        const reg = getCachedRegExp(state, pattern, AnchorMode.END, false);
        reg.lastIndex = 0;
        const result = reg.exec(line.substring(0, position));
        return result ? [result.index, result[0]] : [-1, null];
    }
}

function matchWithEscape(line: string, position: number, pattern: PatternLike, escape: PatternLike | undefined, state: ITemplateState): [number, string | null] {
    let [pos, matched] = match(line, position, MatchMode.DEFAULT, pattern, state);
    let escaped: boolean = false;
    while (pos !== -1) {
        escaped = checkEscape(state, line, pos, escape);
        if (!escaped) {
            break;
        }
        const next = pos + (matched ? matched.length : 0);
        [pos, matched] = match(line, next, MatchMode.DEFAULT, pattern, state);
    }
    pos = escaped ? -1 : pos;
    return [pos, pos !== -1 ? matched : null];
}

function checkEscape(state: ITemplateState, line: string, offset: number, escape?: PatternLike): boolean {
    if (!escape) return false;
    const [pos] = match(line, offset, MatchMode.PREFIX, escape, state);
    return pos >= 0;
}

interface ILayer {
    pos: number;
    matched: string | null;
    open: boolean;
    prePattern: IPattern;
    nextPattern: IPattern;
}

enum FoundMode {
    PUSH,
    POP,
    NONE,
}

function createLayers(parserConfig: ITemplateOptions, state: ITemplateState, line: string, offset: number): ILayer[] {
    const { beforeEnter, afterEnter, beforeExit, afterExit } = parserConfig;
    const layers: ILayer[] = [];
    let matched: string | null = null;
    while (offset < line.length) {
        let found = FoundMode.NONE;
        let pos: number = -1;
        let tmpPos: number;
        let tmpMatched: string | null = null;
        let pattern: IPattern;
        let prePattern: IPattern;
        let nextPattern: IPattern;
        prePattern = nextPattern = getCurrentPattern(state);
        const { close, children, escape } = prePattern;
        if (close) {
            [tmpPos, tmpMatched] = matchWithEscape(line, offset, close, escape, state);
            if (tmpPos >= 0) {
                found = FoundMode.POP;
                pos = tmpPos;
                matched = tmpMatched;
            }
        }
        if (children) {
            for (const child of children) {
                const { open } = child;
                if (open) {
                    [tmpPos, tmpMatched] = matchWithEscape(line, offset, open, escape, state);
                    if (tmpPos >= 0 && (pos === -1 || tmpPos < pos)) {
                        found = FoundMode.PUSH;
                        pos = tmpPos;
                        matched = tmpMatched;
                        nextPattern = child;
                    }
                }
            }
        }
        if (found !== FoundMode.NONE) {
            state.textBefore += line.slice(offset, pos);
            if (found === FoundMode.PUSH) {
                pattern = nextPattern;
                beforeEnter && beforeEnter(state, { line, pos, textBefore: state.textBefore, matched, pattern });
                pushPatternContext(state, pattern!);
                afterEnter && afterEnter(state,{ line, pos, textBefore: state.textBefore, matched, pattern });
            } else {
                pattern = prePattern;
                beforeExit && beforeExit(state, { line, pos, textBefore: state.textBefore, matched, pattern });
                popPatternContext(state);
                afterExit && afterExit(state, { line, pos, textBefore: state.textBefore, matched, pattern });
                nextPattern = getCurrentPattern(state);
            }
            state.textBefore = '';
            layers.push({
                pos,
                matched,
                open: found === FoundMode.PUSH,
                prePattern,
                nextPattern,
            });
            offset = pos + (matched ? matched.length : 0);
        } else {
            state.textBefore += line.slice(offset);
            break;
        }
    }
    return layers;
}

function syncState(config: EditorConfiguration, state: ITemplateState, stream: StringStream, layer: ILayer) {
    if (layer.open && layer.nextPattern.mode) {
        pushStateContext(config, state, layer.nextPattern.mode, stream);
    } else if (!layer.open && layer.prePattern.mode) {
        popStateContext(state);
    }
}

function tokenPattern(config: EditorConfiguration, stream: StringStream, state: ITemplateState) {
    const { layers } = state;
    const layer = layers && layers[0];
    if (!layer) {
        throw new Error('This is impossible!');
    }
    const { open, pos, matched, prePattern, nextPattern } = layer;
    const pattern = open ? nextPattern : prePattern;
    const { patternStyles } = pattern;
    if (stream.pos !== pos || !patternStyles) {
        throw new Error('This is impossible!');
    }
    state.useRoot = true;
    stream.pos = pos + (matched ? matched.length : 0);
    syncState(config, state, stream, layer);
    layers!.shift();
    if (stream.eol()) {
        state.textBefore += '\n';
    }
    return patternStyles[open ? 0 : 1];
}

function tokenUntil(config: EditorConfiguration, stream: StringStream, state: ITemplateState, until: number, shift: boolean, syncStateWhenReach: boolean) {
    const localMode = getLocalMode(state);
    const localState= getLocalState(state);
    const { layers } = state;
    let style: string | null;
    if (localMode && localMode.token) {
        style = localMode.token(stream, localState);
        if (stream.pos > until) {
            stream.backUp(stream.pos - until);
        }
    } else {
        style = null;
        stream.pos = until;
    }
    if (layers && layers[0]) {
        const layer = layers[0];
        if (stream.pos === until) {
            if (syncStateWhenReach) {
                syncState(config, state, stream, layer);
            }
            if (shift) {
                layers.shift();
            }
        }
    }
    if (stream.eol()) {
        state.textBefore += '\n';
    }
    return style;
}

function token(config: EditorConfiguration, parserConfig: ITemplateOptions, stream: StringStream, state: ITemplateState) {
    if (!state.start || stream.sol()) {
        state.start = true;
        state.useRoot = false;
        state.layers = createLayers(parserConfig, state, stream.string, stream.start);
    }
    const layer: ILayer | undefined = state.layers && state.layers[0];
    if (layer) {
        const { prePattern, nextPattern, pos, matched, open } = layer;
        const end = pos + (matched ? matched.length : 0);
        if (stream.start < pos) {
            return tokenUntil(config, stream, state, pos, false, false);
        } else if (stream.start === pos) {
            const pattern = open ? nextPattern : prePattern;
            const { patternStyles, includePattern } = pattern;
            if (patternStyles) {
                return tokenPattern(config, stream, state);
            } else if (open && includePattern) {
                nextPattern.mode && pushStateContext(config, state, nextPattern.mode, stream);
                return tokenUntil(config, stream, state, end, true, false);
            } else if (!open && !includePattern ) {
                prePattern.mode && popStateContext(state);
                return tokenUntil(config, stream, state, end, true, false);
            } else {
                return tokenUntil(config, stream, state, end, true, true);
            }
        } else if (stream.start < end) {
            return tokenUntil(config, stream, state, end, true, true);
        } else {
            throw new Error('This is impossible!');
        }
    } else {
        const localMode = getLocalMode(state);
        const localState = getLocalState(state);
        if (localMode && localMode.token) {
            return localMode.token(stream, localState);
        } else {
            stream.pos = stream.string.length;
            return null;
        }
    }
}

function copyPatternContext(context: IPatternContext): IPatternContext;
function copyPatternContext(context: IPatternContext | null): IPatternContext | null;
function copyPatternContext(context: IPatternContext | null): IPatternContext | null {
    if (!context) return null;
    return {
        pre: copyPatternContext(context.pre),
        pattern: context.pattern,
    }
}

function copyStateContext(context: IStateContext | null): IStateContext | null {
    if (!context) return null;
    return {
        pre: copyStateContext(context.pre),
        mode: context.mode,
        state: CodeMirror.copyState(context.mode, context.state),
    }
}

const FLAG_KEYWORDS = ['if'];

CodeMirror.defineMode('cxj-template-flag', (): Mode<{}> => {
    return {
        token(stream) {
            if (stream.eatSpace()) {
                return null;
            }
            if (stream.eatWhile(REG_WORD)) {
                const matched = stream.current();
                const idx = FLAG_KEYWORDS.indexOf(matched);
                return idx >= 0 ? `keyword cxj-template-flag-keyword cxj-template-flag-keyword-${matched}` : null;
            }
            stream.next();
            return null;
        }
    }
});

CodeMirror.defineMode('cxj-template', (config, parserConfig: ITemplateOptions): Mode<ITemplateState> => {
    const {
        mode, codeMode,
        open, close,
        beforeEnter: customBeforeEnter,
        afterExit: customAfterExit,
        ...rest
    } = parserConfig;
    const defaultOptions = createDefaultOptions(mode, codeMode);
    const {
        beforeEnter: defaultBeforeEnter,
        afterExit: defaultAfterExit,
        ...restDefaultOptions
    } = defaultOptions;
    const finalParserConfig: ITemplateOptions = {
        ...restDefaultOptions,
        ...rest,
        beforeEnter(state: ITemplateState, info) {
            defaultBeforeEnter!(state, info);
            customBeforeEnter && customBeforeEnter(state, info);
        },
        afterExit(state: ITemplateState, info) {
            defaultAfterExit!(state, info);
            customAfterExit && customAfterExit(state, info);
        }
    };
    const { mode: baseMode } = finalParserConfig;
    const baseModeObj = baseMode ? CodeMirror.getMode(config, baseMode) : null;
    const initialStateContext: IStateContext | null = baseModeObj ? {
        pre: null,
        mode: baseModeObj,
        state: CodeMirror.startState(baseModeObj),
    } : null;
    // noinspection JSUnusedGlobalSymbols
    const modeObj = {
        token: (ss: StringStream, state: ITemplateState) => token(config, finalParserConfig, ss, state),
        startState (): ITemplateState {
            return {
                textBefore: '',
                patternContext: {
                    pre: null,
                    pattern: finalParserConfig,
                },
                stateContext: initialStateContext,
                useRoot: false,
                start: false,
                regExpCache: {},
                customs: {},
            };
        },
        copyState (state: ITemplateState): ITemplateState {
            return {
                ...state,
                layers: [...state.layers || []],
                patternContext: copyPatternContext(state.patternContext),
                stateContext: copyStateContext(state.stateContext),
                customs: cloneDeep(state.customs),
            };
        },
        indent (state: ITemplateState, textAfter: string, line?: string) {
            const localMode = getLocalMode(state);
            if (localMode && localMode.indent) {
                const localState= getLocalState(state);
                return (localMode as any).indent(localState, textAfter, line);
            }
            else {
                return CodeMirror.Pass;
            }
        },
        innerMode (state: ITemplateState) {
            return {
                state: getLocalState(state) || state,
                mode: getLocalMode(state) || modeObj,
            };
        }
    };
    return modeObj;
});

export function createDefaultOptions(baseMode: any, codeMode: any): ITemplateOptions {
    const singleQuote: IPattern = {
        mode: null,
        open: '\'',
        close: '\'',
        escape: '\\',
    };
    const doubleQuote: IPattern = {
        mode: null,
        open: '"',
        close: '"',
        escape: '\\',
    };
    const parenthesis: IPattern = {
        mode: null,
        open: '(',
        close: ')',
    };
    const bracket: IPattern = {
        mode: null,
        open: '[',
        close: ']',
    };
    const brace: IPattern = {
        mode: null,
        open: '{',
        close: '}',
    };
    const children = [singleQuote, doubleQuote, parenthesis, bracket, brace];
    parenthesis.children = bracket.children = brace.children = children;
    const code: IPattern = {
        mode: codeMode,
        open: /#{\s*:?/,
        close: '}',
        children,
        patternStyles: ['bracket cxj-code open', 'bracket cxj-code close'],
    };
    const templateHeader: IPattern = {
        mode: 'cxj-template-flag',
        open: '#[',
        close: ']',
        patternStyles: ['bracket cxj-template cxj-template-flag open', 'bracket cxj-template cxj-template-flag close'],
    };
    const template: IPattern = {
        mode: baseMode,
        open (text: string, from: number, state: ITemplateState) {
            let pos = text.indexOf('[', from);
            if (state.customs.justExitTemplate !== true || (pos >= 0 && !REG_SPACE.test(state.textBefore + text.slice(from, pos)))) {
                pos = -1;
            }
            return pos >= 0 ? [pos, '['] : [-1, null];
        },
        close: ']',
        children: [
            code,
            ...children,
        ],
        patternStyles: ['bracket cxj-template open', 'bracket cxj-template close'],
    };
    return {
        name: 'cxj-template',
        mode: baseMode,
        codeMode,
        afterExit(state: ITemplateState, { pattern }) {
            if (pattern === template || pattern === templateHeader) {
                state.customs.justExitTemplate = true;
            }
        },
        beforeEnter(state: ITemplateState) {
            state.customs.justExitTemplate = false;
        },
        children: [
            singleQuote,
            doubleQuote,
            code,
            templateHeader,
            template,
        ],
    };
}
