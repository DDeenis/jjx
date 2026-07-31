const path = require("node:path");

class Disposable {
  constructor(dispose = () => {}) {
    this.dispose = dispose;
  }

  static from(...disposables) {
    return new Disposable(() => disposables.forEach((disposable) => disposable.dispose()));
  }
}

class EventEmitter {
  listeners = [];

  event = (listener, thisArgs, disposables) => {
    const wrapped = thisArgs ? listener.bind(thisArgs) : listener;
    this.listeners.push(wrapped);
    const disposable = new Disposable(() => {
      const index = this.listeners.indexOf(wrapped);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    });
    disposables?.push(disposable);
    return disposable;
  };

  fire(data) {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose() {
    this.listeners.length = 0;
  }
}

class Uri {
  constructor(scheme, fsPath, query = "") {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath;
    this.query = query;
  }

  static file(fsPath) {
    return new Uri("file", path.resolve(fsPath));
  }

  static joinPath(base, ...parts) {
    return Uri.file(path.join(base.fsPath, ...parts));
  }

  with(change) {
    return new Uri(change.scheme ?? this.scheme, change.path ?? this.fsPath, change.query ?? this.query);
  }

  toString() {
    return `${this.scheme}://${this.fsPath}?${this.query}`;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

class CancellationTokenSource {
  emitter = new EventEmitter();
  token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event,
  };

  cancel() {
    this.token.isCancellationRequested = true;
    this.emitter.fire(undefined);
  }

  dispose() {
    this.emitter.dispose();
  }
}

const noopEvent = () => new Disposable();
let configuration = {};

const workspace = {
  workspaceFolders: [],
  getConfiguration: () => ({
    get: (key) => configuration[key],
  }),
  onDidChangeWorkspaceFolders: noopEvent,
  onDidChangeConfiguration: noopEvent,
  registerFileSystemProvider: () => new Disposable(),
  createFileSystemWatcher: () => ({
    onDidCreate: noopEvent,
    onDidChange: noopEvent,
    onDidDelete: noopEvent,
    dispose() {},
  }),
  fs: {},
};

const window = {
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  registerWebviewViewProvider: () => new Disposable(),
  createTreeView: () => ({ dispose() {} }),
};

const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => new Disposable(),
};

class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

module.exports = {
  CancellationTokenSource,
  commands,
  Disposable,
  env: { clipboard: { writeText: async () => undefined } },
  Event: class Event {},
  EventEmitter,
  FileChangeEvent: class FileChangeEvent {},
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  FileDecoration: class FileDecoration {},
  FileDecorationProvider: class FileDecorationProvider {},
  FileStat: class FileStat {},
  FileSystemError: class FileSystemError extends Error {},
  FileSystemProvider: class FileSystemProvider {},
  FileType: { File: 1, Directory: 2 },
  MarkdownString: class MarkdownString {},
  RelativePattern,
  scm: { createSourceControl: () => ({ dispose() {} }) },
  TabInputText: class TabInputText {},
  TabInputTextDiff: class TabInputTextDiff {},
  ThemeColor,
  TreeDataProvider: class TreeDataProvider {},
  TreeItem: class TreeItem {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeView: class TreeView {},
  Uri,
  window,
  workspace,
};
