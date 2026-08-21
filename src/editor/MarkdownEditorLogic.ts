// The DC runtime supplies its base class dynamically, so this controller uses
// a small factory instead of importing runtime internals.
// @ts-nocheck
import { SAMPLE_MARKDOWN } from './sample';
import { EDITOR_STORAGE_KEY, loadEditorState } from './storage';
import { tauriBridge } from './tauriBridge';
import { CommentMethods } from './commentMethods';
import { DiagramMethods } from './diagramMethods';
import { EditingFileLayoutMethods } from './editingFileLayoutMethods';
import { DEFAULT_LONG_IMAGE_PRESET } from './longImageComposer';
import { LongImageMethods } from './longImageMethods';
import { LocalFileSyncMethods } from './localFileSyncMethods';
import { InsertPasteMethods } from './insertPasteMethods';
import { DesktopM4Methods } from './desktopM4Methods';
import { GlobalSearchMethods } from './globalSearchMethods';
import { TabMethods } from './tabMethods';
import { NavigationMethods } from './navigationMethods';
import { applyPrototypeMethods } from './prototypeMethods';
import { MenubarMethods } from './menubarMethods';
import { PreviewSearchMethods } from './previewSearchMethods';
import { SearchReplaceMethods } from './searchReplaceMethods';
import { FontMethods } from './fontMethods';
import { TypewriterMethods } from './typewriterMethods';
import { loadSettings } from './settings';
import { SettingsMethods } from './settingsMethods';
import { FileTreeMethods } from './fileTreeMethods';
import { ViewMethods } from './viewMethods';
import { ContextMenuMethods } from './contextMenuMethods';

export function createMarkdownEditorComponent(DCLogic, React) {
  const Component = class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.sourceRef = React.createRef();
    this.previewRef = React.createRef();
    this.previewTitleRef = React.createRef();
    this.previewPaneRef = React.createRef();
    this.outlineButtonRef = React.createRef();
    this.outlineListRef = React.createRef();
    this.outlineCountRef = React.createRef();
    this.undoButtonRef = React.createRef();
    this.redoButtonRef = React.createRef();
    this.fullscreenIconRef = React.createRef();
    this.fullscreenLabelRef = React.createRef();
    this.dividerRef = React.createRef();
    this.splitRef = React.createRef();
    this.fileNameRef = React.createRef();
    this.recentMenuAnchorRef = React.createRef();
    this.dirtyDotRef = React.createRef();
    this.saveStatusRef = React.createRef();
    this.countRef = React.createRef();
    this.fontSizeRef = React.createRef();
    this.previewFontSizeRef = React.createRef();
    this.fullscreenFontSizeRef = React.createRef();
    this.paperPickerRef = React.createRef();
    this.fontSelectRef = React.createRef();
    this.fontSelectSlotRef = React.createRef();
    this.moreToolsRef = React.createRef();
    this.immersiveWideRef = React.createRef();
    this.headerMoreRef = React.createRef();
    this.headerMenuRef = React.createRef();
    this.fontSize = 19;
    this.previewFontSize = 19;
    this.fontFamily = '';
    this.searchBarRef = React.createRef();
    this.searchInputRef = React.createRef();
    this.replaceInputRef = React.createRef();
    this.searchCountRef = React.createRef();
    this.searchCaseRef = React.createRef();
    this.searchWordRef = React.createRef();
    this.searchRegexRef = React.createRef();
    this.searchExpandRef = React.createRef();
    this.searchOpen = false;
    this.searchCaseSensitive = false;
    this.searchWholeWord = false;
    this.searchRegex = false;
    this.searchReplaceExpanded = false;
    this._searchMatches = [];
    this._searchIndex = -1;
    this._searchAnchor = 0;
    this.sourceHighlightRef = React.createRef();
    this.previewSearchBarRef = React.createRef();
    this.previewSearchInputRef = React.createRef();
    this.previewSearchCountRef = React.createRef();
    this.previewSearchOpen = false;
    this._previewSearchRanges = [];
    this._previewSearchIndex = -1;
    this.selBarRef = React.createRef();
    this.commentsRef = React.createRef();
    this.commentsResizeRef = React.createRef();
    this.commentListRef = React.createRef();
    this.commentCountRef = React.createRef();
    this.previewCommentCountRef = React.createRef();
    this.themeIconRef = React.createRef();
    this.viewModeSwitcherRef = React.createRef();
    this.documentSidebarRef = React.createRef();
    this.documentSidebarResizeRef = React.createRef();
    this.documentListRef = React.createRef();
    this.documentCountRef = React.createRef();
    this.footerPathRef = React.createRef();
    this.tabBarRef = React.createRef();
    this.comments = [];
    this.typewriterActive = false;
    this.fileTreeRoot = null;
    this.fileTreeEntries = [];
    this.commentsPanelWidth = 340;
    this.documentSidebarWidth = 236;
    this.theme = 'dark';
    this.paperDark = ''; // 纸色按主题分别记忆；空 = 该主题默认
    this.paperLight = '';
    this.immersiveWide = false;
    this.longImageWidth = DEFAULT_LONG_IMAGE_PRESET;
    this.longImageMarks = true;
    this._themeTouched = false;
    this.panelOpen = false;
    this.previewFullscreen = false;
    this.outlineOpen = false;
    this.viewMode = 'split';
    this._pending = null;
    this.fileHandle = null;
    this.dirty = false;
    this._saveT = null;
    this._localFileModifiedAt = 0;
    this._localWriteBusy = false;
    this._localFileConflict = false;
    this._fileWatchFocus = null;
    this._draftSavedAt = 0;
    this.localFilePath = null;
    this._startedWithSample = false;
    this._localImageCache = new Map();
    this._mermaidBatch = 0;
  }

  get LS_KEY() { return EDITOR_STORAGE_KEY; }

  SAMPLE() {
    return SAMPLE_MARKDOWN;
  }

  componentDidMount() { this._waitLibs(0); }

  _waitLibs(tries) {
    if (window.marked) {
      this._init();
    } else if (tries < 80) {
      setTimeout(() => this._waitLibs(tries + 1), 60);
    } else if (this.saveStatusRef.current) {
      this.saveStatusRef.current.textContent = '渲染库加载失败';
    }
  }

  _init() {
    const src = this.sourceRef.current;
    const prev = this.previewRef.current;
    if (!src || !prev) return;
    // M2-SETTINGS：设置面板入口按钮由 M2-UI 统一接线；E2E 经此钩子调用组件方法驱动面板。
    src._mdEditor = this;

    if (window.marked.setOptions) window.marked.setOptions({ gfm: true, breaks: true });
    let initial = this.SAMPLE();
    let name = '未命名.md';
    // 未持久化过主题时跟随系统外观
    this.theme = this.props.theme
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const saved = loadEditorState();
    this._startedWithSample = !(saved && typeof saved.content === 'string');
    if (saved && typeof saved.content === 'string') {
      initial = this._cleanOpenedMarkdown(saved.content);
      if (saved.fileName) name = saved.fileName;
      if (saved.fontSize) this.fontSize = saved.fontSize;
      if (saved.previewFontSize) this.previewFontSize = saved.previewFontSize;
      else if (saved.fontSize) this.previewFontSize = saved.fontSize;
      if (Array.isArray(saved.comments)) this.comments = saved.comments;
      if (saved.theme) { this.theme = saved.theme; this._themeTouched = true; }
      if (saved.paperDark) this.paperDark = saved.paperDark;
      if (saved.paperLight) this.paperLight = saved.paperLight;
      if (saved.immersiveWide) this.immersiveWide = true;
      if (saved.longImageWidth) this.longImageWidth = saved.longImageWidth;
      if (saved.longImageMarks === false) this.longImageMarks = false;
      if (saved.typewriterActive) this.typewriterActive = true;
      if (saved.fontFamily) this.fontFamily = saved.fontFamily;
      if (saved.paper) {
        // 迁移旧的单份纸色记忆：墨黑归暗色，其余归亮色
        if (saved.paper === 'ink') this.paperDark = this.paperDark || saved.paper;
        else this.paperLight = this.paperLight || saved.paper;
      }
    }

    src.value = initial;
    this.fileName = name;
    if (this.fileNameRef.current) this.fileNameRef.current.textContent = name;
    this._applyTheme();
    this._buildPaperPicker();
    this._syncImmersiveWideButton();
    this._applyFont();
    this._renderPreview();
    this._updateCount();
    this._resetEditingHistory();
    // M2-SETTINGS：加载设置并应用一次（拼写检查/lang 属性）；状态栏如实反映自动保存开关。
    this.settings = loadSettings();
    this._applySettings();
    this._setStatus(this.settings.autosave ? '就绪 · 自动保存已开启' : '就绪 · 自动保存已关闭 · 草稿仍保存在浏览器');
    this._applyProps();

    src.addEventListener('beforeinput', () => this._syncCurrentEditingState());
    src.addEventListener('input', (e) => {
      this._recordEditingHistory(e.inputType || '');
      this._renderPreview();
      this._touch();
    });
    prev.addEventListener('click', (e) => this._openPreviewLink(e));
    prev.addEventListener('scroll', () => this._syncActiveOutlineItem());
    src.addEventListener('dblclick', () => this._onSourceDbl());
    prev.addEventListener('dblclick', (e) => this._onPreviewDbl(e));
    src.addEventListener('keydown', (e) => this._sourceKeydown(e));
    src.addEventListener('paste', (e) => this._onSourcePaste(e));
    this._initTableToolbar();
    this._initTaskToggle();
    this._initDesktopDrop();
    this._initWindowState();
    this._initCloseGuard();
    this._keyHandler = (e) => {
      if (this._handleMenubarAltShortcut && this._handleMenubarAltShortcut(e)) return;
      if (this._handleTabShortcut && this._handleTabShortcut(e)) return;
      if (this._handleSearchShortcut(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) this.onSaveAs();
        else this.onSave();
      }
      if (e.key === 'Escape' && this.previewFullscreen) {
        e.preventDefault();
        this.togglePreviewFullscreen(false);
      } else if (e.key === 'Escape' && this.outlineOpen) {
        e.preventDefault();
        this.toggleOutline(false);
      }
    };
    window.addEventListener('keydown', this._keyHandler);
    this._resizeHandler = () => {
      this._syncViewMode();
    };
    window.addEventListener('resize', this._resizeHandler);

    this._initDivider();
    this._initSearchBar();
    this._initPreviewSearch();
    this._initComments();
    this._renderComments();
    // 打字机模式：监听光标活动
    src.addEventListener('click', () => {
      if (typeof this._applyTypewriterScroll === 'function') this._applyTypewriterScroll();
    });
    src.addEventListener('keyup', () => {
      if (typeof this._applyTypewriterScroll === 'function') this._applyTypewriterScroll();
    });
    // 分屏滚动同步（源码 ↔ 预览双向按比例）
    if (typeof this._initScrollSync === 'function') this._initScrollSync();
    // 字体：恢复导入字体（IndexedDB）并构建选择器
    if (typeof this._restoreImportedFonts === 'function') this._restoreImportedFonts();
    else if (typeof this._buildFontSelect === 'function') this._buildFontSelect();
    // 恢复持久化的模式状态
    this._applyTypewriterMode();
    this._syncViewMode();
    // 桌面端：接上应用菜单与「双击 .md 打开」事件。
    if (tauriBridge) this._initDesktop();
    // 上次会话打开过本地文件时，恢复与它的双向同步关联。
    this._restoreLocalFileLink();
    // M5：多文档标签页（含旧数据迁移）——最后初始化，接管当前文档为首个标签。
    this._initTabs();
    // 右键菜单：标签栏/侧边栏在 _initTabs 与模板中已就绪，最后接线。
    this._initContextMenus();
    // 侧边栏「文件」页签：初始渲染当前文档所在目录的 .md 列表（桌面端）。
    if (typeof this._renderCurrentDirFiles === 'function') this._renderCurrentDirFiles();
  }

  componentDidUpdate() { this._applyProps(); }

  _applyProps() {
    const prev = this.previewRef.current, src = this.sourceRef.current;
    if (!prev || !src) return;
    this._syncPreviewEditable();
    const wrap = this.props.wrapSource ?? true;
    src.style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
    src.setAttribute('wrap', wrap ? 'soft' : 'off');
    if (!this._themeTouched && this.props.theme && this.props.theme !== this.theme) {
      this.theme = this.props.theme; this._applyTheme();
    }
    // M2-SETTINGS：每次渲染提交后重申拼写检查/lang 属性——DC 模板重渲染
    // （updateHtml 流式更新）会按模板重设 spellcheck="false"，这里保证设置胜出。
    this._applySettings();
  }

  componentWillUnmount() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    if (this._outlineJumpT) clearTimeout(this._outlineJumpT);
    this._stopLocalFileWatcher();
    document.body.style.overflow = '';
  }

  renderVals() {
    return {
      ...this._coreVals(),
      ...this._formatVals()
    };
  }

  _coreVals() {
    return {
      sourceRef: this.sourceRef,
      previewRef: this.previewRef,
      previewTitleRef: this.previewTitleRef,
      previewPaneRef: this.previewPaneRef,
      outlineButtonRef: this.outlineButtonRef,
      outlineListRef: this.outlineListRef,
      outlineCountRef: this.outlineCountRef,
      undoButtonRef: this.undoButtonRef,
      redoButtonRef: this.redoButtonRef,
      fullscreenIconRef: this.fullscreenIconRef,
      fullscreenLabelRef: this.fullscreenLabelRef,
      dividerRef: this.dividerRef,
      splitRef: this.splitRef,
      fileNameRef: this.fileNameRef,
      recentMenuAnchorRef: this.recentMenuAnchorRef,
      dirtyDotRef: this.dirtyDotRef,
      saveStatusRef: this.saveStatusRef,
      countRef: this.countRef,
      fontSizeRef: this.fontSizeRef,
      previewFontSizeRef: this.previewFontSizeRef,
      fullscreenFontSizeRef: this.fullscreenFontSizeRef,
      paperPickerRef: this.paperPickerRef,
      fontSelectRef: this.fontSelectRef,
      fontSelectSlotRef: this.fontSelectSlotRef,
      moreToolsRef: this.moreToolsRef,
      immersiveWideRef: this.immersiveWideRef,
      headerMoreRef: this.headerMoreRef,
      headerMenuRef: this.headerMenuRef,
      themeIconRef: this.themeIconRef,
      searchBarRef: this.searchBarRef,
      searchInputRef: this.searchInputRef,
      replaceInputRef: this.replaceInputRef,
      searchCountRef: this.searchCountRef,
      searchCaseRef: this.searchCaseRef,
      searchWordRef: this.searchWordRef,
      searchRegexRef: this.searchRegexRef,
      searchExpandRef: this.searchExpandRef,
      sourceHighlightRef: this.sourceHighlightRef,
      previewSearchBarRef: this.previewSearchBarRef,
      previewSearchInputRef: this.previewSearchInputRef,
      previewSearchCountRef: this.previewSearchCountRef,
      selBarRef: this.selBarRef,
      commentsRef: this.commentsRef,
      commentsResizeRef: this.commentsResizeRef,
      commentListRef: this.commentListRef,
      commentCountRef: this.commentCountRef,
      previewCommentCountRef: this.previewCommentCountRef,
      viewModeSwitcherRef: this.viewModeSwitcherRef,
      documentSidebarRef: this.documentSidebarRef,
      documentSidebarResizeRef: this.documentSidebarResizeRef,
      documentListRef: this.documentListRef,
      documentCountRef: this.documentCountRef,
      footerPathRef: this.footerPathRef,
      tabBarRef: this.tabBarRef,
      showEditorMode: () => this.setViewMode('editor'),
      showSplitMode: () => this.setViewMode('split'),
      showPreviewMode: () => this.setViewMode('preview'),
      toggleDocumentSidebar: () => this.toggleDocumentSidebar(),
      closeDocumentSidebar: () => this.closeDocumentSidebar(),
      sidebarTabFiles: () => { this._setSidebarTab('files'); this._renderCurrentDirFiles(); },
      sidebarTabOutline: () => this._setSidebarTab('outline'),
      fontInc: () => this._setFont(this.fontSize + 1),
      fontDec: () => this._setFont(this.fontSize - 1),
      sourceFontInc: () => this._setSourceFont(this.fontSize + 1),
      sourceFontDec: () => this._setSourceFont(this.fontSize - 1),
      previewFontInc: () => this._setPreviewFont((this.previewFontSize ?? this.fontSize) + 1),
      previewFontDec: () => this._setPreviewFont((this.previewFontSize ?? this.fontSize) - 1),
      toggleTheme: () => this.toggleTheme(),
      togglePreviewFullscreen: () => this.togglePreviewFullscreen(),
      toggleImmersiveWide: () => this.toggleImmersiveWide(),
      ...this._menuVals(),
      toggleOutline: () => this.toggleOutline(),
      openLongImage: () => this.openLongImage(),
      openSettings: () => this.openSettings(),
      closeSettings: () => this.closeSettings(),
      toggleSearch: () => this.toggleSearch(),
      closeSearch: () => this.closeSearch(),
      searchPrev: () => this.searchPrev(),
      searchNext: () => this.searchNext(),
      toggleSearchCase: () => this.toggleSearchCase(),
      toggleSearchWord: () => this.toggleSearchWord(),
      toggleSearchRegex: () => this.toggleSearchRegex(),
      toggleSearchReplaceRow: () => this.toggleSearchReplaceRow(),
      replaceCurrent: () => this.replaceCurrent(),
      replaceAll: () => this.replaceAll(),
      togglePreviewSearch: () => this.togglePreviewSearch(),
      closePreviewSearch: () => this.closePreviewSearch(),
      previewSearchPrev: () => this.previewSearchPrev(),
      previewSearchNext: () => this.previewSearchNext(),
      toggleComments: () => this._openPanel(),
      closePanel: () => this._openPanel(false),
      toggleTypewriterMode: () => this.toggleTypewriterMode(),
      openFileTree: () => this.openFileTree(),
      copySel: () => this.copySel(),
      markMarker: () => this.markMarker(),
      markWavy: () => this.markWavy(),
      markStraight: () => this.markStraight(),
      writeIdea: () => this.writeIdea(),
      copyAll: (e) => this.copyAll(e),
      copyFull: (e) => this.copyFull(e),
      noop: (e) => { if (e && e.preventDefault) e.preventDefault(); },
      onOpen: () => this.onOpen(),
      onSave: () => this.onSave(),
      onSaveAs: () => this.onSaveAs(),
      onNew: () => this.onNew(),
      undoEdit: () => this.undoEdit(),
      redoEdit: () => this.redoEdit(),
      fmtH: () => this._linePrefix('## '),
      fmtB: () => this._wrapSel('**', '**', '粗体'),
      fmtI: () => this._wrapSel('*', '*', '斜体'),
      fmtQuote: () => this._linePrefix('> '),
      fmtList: () => this._linePrefix('- '),
      fmtCode: () => this._wrapSel('`', '`', 'code'),
      fmtLink: () => this._wrapSel('[', '](https://)', '链接文字'),
      toggleMoreTools: () => this.toggleMoreTools(),
      copyHtml: () => this.copyHtmlSelection()
    };
  }

  // 菜单栏与顶栏溢出菜单的 renderVals（独立方法控制行数）。
  _menuVals() {
    return {
      toggleHeaderMenu: () => this.toggleHeaderMenu(),
      toggleMenubar: (key: string) => this.toggleMenubar(key),
      toggleMenubarFile: () => this.toggleMenubar('file'),
      toggleMenubarEdit: () => this.toggleMenubar('edit'),
      toggleMenubarPara: () => this.toggleMenubar('para'),
      toggleMenubarFormat: () => this.toggleMenubar('format'),
      toggleMenubarView: () => this.toggleMenubar('view'),
      toggleMenubarTheme: () => this.toggleMenubar('theme'),
      toggleMenubarHelp: () => this.toggleMenubar('help'),
      menuTheme: () => this.toggleTheme(),
      menuSettings: () => this.openSettings(),
      importFont: () => this._importFont(),
      menuUndo: () => this.undoEdit(),
      menuRedo: () => this.redoEdit(),
      // 打开搜索条是覆盖型动作：先关菜单，避免菜单浮层遮住搜索条（搜索条在源码区上方）
      menuSearch: () => { this.toggleMenubar(''); this.toggleSearch(); },
      menuH1: () => this._linePrefix('# '),
      menuH2: () => this._linePrefix('## '),
      menuH3: () => this._linePrefix('### '),
      menuPaperInk: () => this.setPaper('ink'),
      menuPaperParchment: () => this.setPaper('parchment'),
      menuPaperCream: () => this.setPaper('cream'),
      menuPaperSnow: () => this.setPaper('snow'),
      menuPaperGreen: () => this.setPaper('green'),
      menuAbout: () => this.openSettings(),
      menuFileNew: () => { this.toggleMenubar(''); this.addTab(); },
      menuFileOpen: () => { this.toggleMenubar(''); this.onOpen(); },
      menuOpenFolder: () => { this.toggleMenubar(''); if (typeof this._pickFolder === 'function') this._pickFolder(); else this.openFileTree(); },
      menuFileSave: () => { this.toggleMenubar(''); this.onSave(); },
      menuFileSaveAs: () => { this.toggleMenubar(''); this.onSaveAs(); },
      menuExportHtml: () => { this.toggleMenubar(''); this.onExportHtml(); },
      menuExportPdf: () => { this.toggleMenubar(''); this.onExportPdf(); },
      menuExportWord: () => { this.toggleMenubar(''); this.onExportWord(); },
      menuInsertImage: () => { this.toggleMenubar(''); this.onInsertImage(); },
      menuRecent: () => { this.toggleMenubar(''); this.toggleRecentMenu(); },
      menuQuickOpen: () => { this.toggleMenubar(''); this.onQuickOpen(); }
    };
  }

  _formatVals() {
    return {
      fmtStrike: () => this._wrapSel('~~', '~~', '删除线'),
      fmtHighlight: () => this._wrapSel('==', '==', '高亮'),
      fmtUnderline: () => this._wrapSel('<u>', '</u>', '下划线'),
      fmtSup: () => { this._closeMoreTools(); this._wrapSel('^', '^', '上标'); },
      fmtSub: () => { this._closeMoreTools(); this._wrapSel('~', '~', '下标'); },
      fmtTask: () => { this._closeMoreTools(); this._linePrefix('- [ ] '); },
      fmtCodeBlock: () => { this._closeMoreTools(); this._wrapSel('```\n', '\n```', 'code'); },
      fmtFootnote: () => { this._closeMoreTools(); this._wrapSel('[^', ']', '1'); },
      fmtHr: () => { this._closeMoreTools(); this._insertHr(); },
      fmtImage: () => { this._closeMoreTools(); this.onInsertImage(); },
      fmtTable: () => { this._closeMoreTools(); this._insertTable(); }
    };
  }
  };
  applyPrototypeMethods(
    Component,
    ViewMethods,
    NavigationMethods,
    SearchReplaceMethods,
    PreviewSearchMethods,
    CommentMethods,
    DiagramMethods,
    LongImageMethods,
    TypewriterMethods,
    FileTreeMethods,
    EditingFileLayoutMethods,
    LocalFileSyncMethods,
    InsertPasteMethods,
    SettingsMethods,
    DesktopM4Methods,
    GlobalSearchMethods,
    FontMethods,
    TabMethods,
    MenubarMethods,
    ContextMenuMethods
  );
  return Component;
}