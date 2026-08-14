// @ts-nocheck
import { tauriBridge } from './tauriBridge.ts';

// 文件树面板：复用 documentSidebarRef 展示已关联文件夹的目录树（.md 文件 + 可展开目录）。
// 顶部提供「选择文件夹」入口（原生目录对话框）；目录节点点击展开/收起子目录；
// 文件节点点击打开（走 editingFileLayoutMethods 的 _openDesktopFile）。
// 根目录记忆在 localStorage，重开自动恢复。
const FILE_TREE_ROOT_KEY = 'md-editor-file-tree-root';

export class FileTreeMethods {
  async openFileTree() {
    const sidebar = this.documentSidebarRef && this.documentSidebarRef.current;
    if (!sidebar) return;
    // 展开侧边栏并切到「文件」页签（Typora 风格：文件树在侧边栏文件页）
    sidebar.classList.remove('is-collapsed');
    sidebar.classList.add('is-mobile-open');
    if (typeof this._setSidebarTab === 'function') this._setSidebarTab('files');
    if (!tauriBridge) {
      this._setStatus('文件树需要桌面端环境');
      return;
    }
    // 未选择过根目录时，恢复上次记忆的目录
    if (!this.fileTreeRoot) {
      const remembered = this._loadFileTreeRoot();
      if (remembered) this.fileTreeRoot = remembered;
    }
    await this._renderFileTree();
  }

  // ===== 根目录选择与记忆 =====

  async _pickFolder() {
    if (!tauriBridge) return;
    const dir = await tauriBridge.pickDirectory();
    if (!dir) return;
    this.fileTreeRoot = dir;
    this._saveFileTreeRoot(dir);
    this._resetTreeExpanded();
    await this._renderFileTree();
  }

  _loadFileTreeRoot() {
    try {
      return localStorage.getItem(FILE_TREE_ROOT_KEY) || null;
    } catch {
      return null;
    }
  }

  _saveFileTreeRoot(dir) {
    try {
      localStorage.setItem(FILE_TREE_ROOT_KEY, dir);
    } catch {
      // 存储不可用时静默降级（与 storage.ts 一致）
    }
  }

  // ===== 展开状态 =====

  _initTreeExpanded() {
    if (!this._treeExpanded) this._treeExpanded = new Set();
  }

  _resetTreeExpanded() {
    this._treeExpanded = new Set();
  }

  // ===== 渲染 =====

  async _renderFileTree() {
    const list = this.documentListRef && this.documentListRef.current;
    if (!list || !tauriBridge) return;
    list.innerHTML = '';
    this._initTreeExpanded();
    // M4（P7）：跨文件搜索框（GlobalSearchMethods mixin）
    if (typeof this._ensureSearchBox === 'function') this._ensureSearchBox(list);

    const header = this.documentSidebarRef.current &&
      this.documentSidebarRef.current.querySelector('.document-sidebar-title');
    if (header) header.textContent = '文件列表';

    // 顶部「选择文件夹」入口：随时可切换根目录
    const picker = document.createElement('button');
    picker.type = 'button';
    picker.className = 'file-tree-picker';
    picker.textContent = '选择文件夹…';
    picker.addEventListener('click', () => this._pickFolder());
    list.appendChild(picker);

    if (!this.fileTreeRoot) {
      const empty = document.createElement('div');
      empty.className = 'file-tree-empty';
      empty.textContent = '尚未选择文件夹';
      list.appendChild(empty);
      return;
    }

    // 根目录名（完整路径放 title）
    const rootLabel = document.createElement('div');
    rootLabel.className = 'file-tree-root';
    rootLabel.textContent = this._displayName(this.fileTreeRoot);
    rootLabel.title = this.fileTreeRoot;
    list.appendChild(rootLabel);

    await this._renderTreeChildren(list, this.fileTreeRoot);
  }

  async _renderTreeChildren(container, dirPath) {
    let entries;
    try {
      entries = await tauriBridge.listDirectory(dirPath);
    } catch {
      const empty = document.createElement('div');
      empty.className = 'file-tree-empty';
      empty.textContent = '无法读取目录';
      container.appendChild(empty);
      return;
    }

    // list_directory 已排序：目录在前、文件在后；此处只取目录与 Markdown 文件
    for (const entry of entries) {
      if (entry.isDir) {
        await this._appendDirNode(container, entry);
      } else if (/\.(md|markdown|txt)$/i.test(entry.name)) {
        this._appendFileNode(container, entry);
      }
    }
  }

  async _appendDirNode(container, entry) {
    const expanded = this._treeExpanded.has(entry.path);
    const row = document.createElement('div');
    row.className = 'file-tree-item file-tree-dir' + (expanded ? ' is-expanded' : '');
    row.title = entry.path;

    const caret = document.createElement('span');
    caret.className = 'file-tree-caret';
    caret.textContent = '\u203A';
    const label = document.createElement('span');
    label.className = 'file-tree-dir-label';
    label.textContent = entry.name;

    row.appendChild(caret);
    row.appendChild(label);
    row.addEventListener('click', () => this._toggleDir(entry, row));
    container.appendChild(row);

    if (expanded) {
      const wrap = document.createElement('div');
      wrap.className = 'file-tree-children';
      container.appendChild(wrap);
      await this._renderTreeChildren(wrap, entry.path);
    }
  }

  async _toggleDir(entry, row) {
    this._initTreeExpanded();
    const path = entry.path;
    if (this._treeExpanded.has(path)) {
      // 收起：移除展开态与子节点容器
      this._treeExpanded.delete(path);
      row.classList.remove('is-expanded');
      const wrap = row.nextElementSibling;
      if (wrap && wrap.classList && wrap.classList.contains('file-tree-children')) {
        wrap.remove();
      }
    } else {
      // 展开：就地插入子节点容器，避免整树重绘丢失滚动位置
      this._treeExpanded.add(path);
      row.classList.add('is-expanded');
      const wrap = document.createElement('div');
      wrap.className = 'file-tree-children';
      row.after(wrap);
      await this._renderTreeChildren(wrap, path);
    }
  }

  _appendFileNode(container, entry) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'file-tree-item file-tree-file';
    item.textContent = entry.name;
    item.title = entry.path;
    item.addEventListener('click', () => this._openFileFromTree(entry.path, entry.name));
    container.appendChild(item);
  }

  // ===== 路径与打开 =====

  // 显示名 = 路径末尾段；兼容 posix 与 Windows 分隔符，不裸切字符串。
  _displayName(pathOrName) {
    if (!pathOrName) return '';
    const raw = String(pathOrName);
    const trimmed = raw.replace(/[\\/]+$/, '');
    // 根路径（如 "/" 或 "C:\"）剥掉分隔符后可能为空或只剩盘符，需保留原形
    if (!trimmed) return raw;
    if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + '\\';
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  }

  async _openFileFromTree(path, name) {
    if (!tauriBridge) return;
    try {
      const data = await tauriBridge.readFile(path);
      if (!data) return;
      this._openDesktopFile({
        path: path,
        name: name,
        content: data.content,
        lastModified: data.lastModified
      });
      this.closeDocumentSidebar();
    } catch {}
  }
}
