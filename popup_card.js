/*
 * Popup Card - 弹窗卡片组件
*/

// 在资源 URL 添加 ?debug=1 可启用开发日志；默认按发布模式运行。
const popupCardDebugEnabled = (() => {
  try {
    const resourceUrl = document.currentScript?.src || [...document.scripts]
      .map((script) => script.src)
      .find((src) => {
        try {
          return new URL(src, window.location.href).pathname.endsWith('/popup_card.js');
        } catch (_error) {
          return false;
        }
      }) || window.location.href;
    return new URL(resourceUrl, window.location.href).searchParams.get('debug') === '1';
  } catch (_error) {
    return false;
  }
})();
const popupCardLog = (...args) => {
  if (popupCardDebugEnabled) console.log(...args);
};

popupCardLog('[popup_card] ========== 开始加载 ==========');

try {
  // ========================================
  // Popup Card 配置编辑器
  // ========================================
  if (!customElements.get('popup-card-editor')) {
    class PopupCardEditor extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._config = {};
        this._popup = { title: '', hide_border: false, hide_title_bar: false, mobile_sheet: false, takeover_click: true, click_exclude: '', jump_enabled: false, jump_path: '', cards: [] };
        this._triggerAction = 'tap';
        this._previewVersion = 0;
      }

      async connectedCallback() {
        if (this._initializing) return;
        this._initializing = true;
        try {
          // 创建原生堆叠卡会触发 HA 延迟加载卡片模块。
          // 创建结果可能早于自定义元素注册完成，因此先等待注册，再获取编辑器。
          const helpers = await window.loadCardHelpers?.();
          if (!helpers || !this.isConnected) return;
          const stackCard = await helpers.createCardElement({
            type: 'vertical-stack',
            cards: [{ type: 'markdown', content: '' }]
          });
          await customElements.whenDefined(stackCard.localName);
          if (!this.isConnected) return;
          const stackClass = customElements.get(stackCard.localName);
          if (!stackClass?.getConfigElement) {
            throw new Error('Home Assistant 堆叠卡编辑器不可用');
          }
          this._stackEditor = await stackClass.getConfigElement();
          if (!this.isConnected) return;
          // 官方堆叠编辑器会额外显示“标题”字段，弹窗卡片不需要该字段，从表单中移除标题项。
          if (Array.isArray(this._stackEditor._schema)) {
            this._stackEditor._schema = this._stackEditor._schema.filter((field) => field.name !== 'title');
          }
          await Promise.all([
            customElements.whenDefined('hui-card-picker'),
            customElements.whenDefined('hui-card-element-editor')
          ]);

          this.shadowRoot.innerHTML = `
            <style>
              ha-expansion-panel { display: block; margin: 0 0 12px; }
              h3 { margin: 0; font-size: 16px; font-weight: 500; }
              .panel-content { padding: 12px 8px 8px; }
              .sub-editor { border: 1px solid var(--divider-color); border-radius: 8px; padding: 12px; }
              .replace { margin: 8px 0; }
              .error { color: var(--error-color); }
              .preview-frame { border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px; background: var(--primary-background-color); overflow: auto; }
              .preview-title { font-size: var(--ha-font-size-xl, 20px); font-weight: var(--ha-font-weight-medium, 500); margin: 0 0 12px; text-align: center; }
              .preview-empty { color: var(--secondary-text-color); padding: 16px; text-align: center; }
            </style>
            <ha-expansion-panel outlined>
              <h3 slot="header">触发卡片</h3>
              <div class="panel-content">
                <div id="trigger-editor" class="sub-editor"></div>
              </div>
            </ha-expansion-panel>
            <ha-expansion-panel outlined>
              <h3 slot="header">弹窗设置</h3>
              <div class="panel-content">
              <ha-form id="popup-form"></ha-form>
              </div>
            </ha-expansion-panel>
            <ha-expansion-panel outlined>
              <h3 slot="header">弹窗卡片</h3>
              <div class="panel-content">
                <h3>弹窗预览</h3>
                <div id="preview-frame" class="preview-frame"></div>
                <h3>卡片配置</h3>
                <div id="popup-cards" class="sub-editor"></div>
              </div>
            </ha-expansion-panel>
          `;

          this._form = this.shadowRoot.getElementById('popup-form');
          this._form.schema = [
            { name: 'title', selector: { text: {} } },
            { name: 'hide_border', selector: { boolean: {} } },
            { name: 'hide_title_bar', selector: { boolean: {} } },
            { name: 'mobile_sheet', selector: { boolean: {} } },
            {
              name: 'popup_trigger',
              selector: {
                select: {
                  mode: 'dropdown',
                  options: [
                    { label: '点击', value: 'tap' },
                    { label: '长按', value: 'hold' },
                    { label: '双击', value: 'double_tap' }
                  ]
                }
              }
            },
            { name: 'takeover_click', selector: { boolean: {} } },
            { name: 'click_exclude', selector: { text: {} }, visible: { field: 'takeover_click', value: true } },
            { name: 'jump_enabled', selector: { boolean: {} } },
            { name: 'jump_path', selector: { text: {} }, visible: { field: 'jump_enabled', value: true } }
          ];
          this._form.computeLabel = (schema) => ({
            title: '弹窗标题',
            hide_border: '隐藏边框',
            hide_title_bar: '隐藏标题栏',
            mobile_sheet: '移动端使用上拉面板',
            popup_trigger: '打开弹窗的操作',
            takeover_click: '接管点击操作',
            click_exclude: '额外排除区域（CSS 选择器，多个使用,号分隔）',
            jump_enabled: '显示跳转按钮',
            jump_path: '跳转路径'
          })[schema.name];
          this._form.computeHelper = (schema) => schema.name === 'click_exclude'
            ? '这些区域保留触发卡片的原生操作'
            : undefined;
          this._form.hass = this._hass;
          this._form.data = {
            title: this._popup.title,
            hide_border: this._popup.hide_border,
            hide_title_bar: this._popup.hide_title_bar,
            mobile_sheet: this._popup.mobile_sheet,
            popup_trigger: this._triggerAction,
            takeover_click: this._popup.takeover_click,
            click_exclude: this._popup.click_exclude,
            jump_enabled: this._popup.jump_enabled,
            jump_path: this._popup.jump_path
          };
          this._form.addEventListener('value-changed', (event) => {
            event.stopPropagation();
            this._popup = { ...this._popup, ...event.detail.value };
            this._triggerAction = event.detail.value.popup_trigger || 'tap';
            this._emitConfig();
          });

          this._stackEditor.hass = this._hass;
          this._stackEditor.lovelace = this._lovelace;
          this._stackEditor.setConfig({ type: 'vertical-stack', cards: this._popup.cards });
          this._stackEditor.addEventListener('config-changed', (event) => {
            event.stopPropagation();
            this._popup.cards = event.detail.config.cards || [];
            this._emitConfig();
          });
          this.shadowRoot.getElementById('popup-cards').appendChild(this._stackEditor);
          this._renderTriggerEditor();
          this._refreshPreview();
        } catch (error) {
          console.error('[popup_card] 配置编辑器初始化失败:', error);
          this.shadowRoot.innerHTML = `<div class="error">原生卡片编辑器加载失败：${error.message}</div>`;
        } finally {
          this._initializing = false;
        }
      }

      disconnectedCallback() {
        clearTimeout(this._previewTimer);
        this._previewVersion++;
      }

      set hass(hass) {
        this._hass = hass;
        if (this._form) this._form.hass = hass;
        if (this._stackEditor) this._stackEditor.hass = hass;
        if (this._triggerEditor) this._triggerEditor.hass = hass;
        if (this._cardPicker) this._cardPicker.hass = hass;
        if (this._previewCard) this._previewCard.hass = hass;
      }

      get hass() {
        return this._hass;
      }

      set lovelace(lovelace) {
        this._lovelace = lovelace;
        if (this._stackEditor) this._stackEditor.lovelace = lovelace;
        if (this._triggerEditor) this._triggerEditor.lovelace = lovelace;
        if (this._cardPicker) this._cardPicker.lovelace = lovelace;
      }

      _configFingerprint(value) {
        if (Array.isArray(value)) return `[${value.map((item) => this._configFingerprint(item)).join(',')}]`;
        if (value && typeof value === 'object') {
          return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${this._configFingerprint(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
      }

      setConfig(config) {
        // Lovelace 会将 config-changed 再次传回 setConfig。
        // 若重复应用完全相同的配置，每次输入都会重建 hui-card-element-editor，导致输入框失焦并丢失滚动位置。
        if (this._configFingerprint(config) === this._configFingerprint(this._config)) return;
        const previousTriggerConfig = this._triggerConfig;
        const previousPopup = this._popup;
        const previousCards = previousPopup?.cards;
        const previousTriggerAction = this._triggerAction;
        this._config = { ...config };
        const popupConfig = config.popup || {};
        let cards = popupConfig.cards;
        if (!Array.isArray(cards)) {
          const legacyCard = popupConfig.card;
          cards = legacyCard
            ? (Array.isArray(legacyCard)
                ? legacyCard
                : legacyCard.type === 'vertical-stack' ? legacyCard.cards : [legacyCard])
            : [];
        }
        this._popup = {
          title: popupConfig.title || '',
          hide_border: (popupConfig.hide_border ?? popupConfig.hide_header) === true,
          hide_title_bar: popupConfig.hide_title_bar === true,
          mobile_sheet: popupConfig.mobile_sheet === true,
          takeover_click: popupConfig.takeover_click !== false,
          click_exclude: typeof popupConfig.click_exclude === 'string' ? popupConfig.click_exclude : '',
          jump_enabled: popupConfig.jump_enabled === true,
          jump_path: typeof popupConfig.jump_path === 'string' ? popupConfig.jump_path : '',
          cards: [...cards]
        };
        this._triggerAction = config.popup_trigger || config.popup?.trigger || 'tap';
        this._triggerConfig = config.popup ? config.card : null;
        if (this._form) {
          const popupSettingsChanged = ['title', 'hide_border', 'hide_title_bar', 'mobile_sheet', 'takeover_click', 'click_exclude', 'jump_enabled', 'jump_path']
            .some((key) => previousPopup?.[key] !== this._popup[key]) ||
            previousTriggerAction !== this._triggerAction;
          if (popupSettingsChanged) {
            this._form.data = {
              title: this._popup.title,
              hide_border: this._popup.hide_border,
              hide_title_bar: this._popup.hide_title_bar,
              mobile_sheet: this._popup.mobile_sheet,
              popup_trigger: this._triggerAction,
              takeover_click: this._popup.takeover_click,
              click_exclude: this._popup.click_exclude,
              jump_enabled: this._popup.jump_enabled,
              jump_path: this._popup.jump_path
            };
          }
          if (this._configFingerprint(previousCards) !== this._configFingerprint(this._popup.cards)) {
            this._stackEditor.setConfig({ type: 'vertical-stack', cards: this._popup.cards });
          }
          if (this._configFingerprint(previousTriggerConfig) !== this._configFingerprint(this._triggerConfig)) {
            this._renderTriggerEditor();
          }
          this._schedulePreviewRefresh();
        }
      }

      _renderTriggerEditor() {
        const host = this.shadowRoot.getElementById('trigger-editor');
        if (!host) return;
        host.replaceChildren();
        this._triggerEditor = null;
        this._cardPicker = null;
        if (this._triggerConfig) {
          const replaceButton = document.createElement('ha-button');
          replaceButton.className = 'replace';
          replaceButton.setAttribute('size', 's');
          replaceButton.setAttribute('appearance', 'outlined');
          replaceButton.setAttribute('variant', 'neutral');
          replaceButton.textContent = '更换触发卡片';
          replaceButton.addEventListener('click', () => this._showCardPicker());
          host.appendChild(replaceButton);
          this._triggerEditor = document.createElement('hui-card-element-editor');
          this._triggerEditor.hass = this._hass;
          this._triggerEditor.lovelace = this._lovelace;
          this._triggerEditor.value = this._triggerConfig;
          this._triggerEditor.addEventListener('config-changed', (event) => {
            event.stopPropagation();
            this._triggerConfig = event.detail.config;
            this._emitConfig();
          });
          host.appendChild(this._triggerEditor);
        } else {
          this._showCardPicker();
        }
      }

      _showCardPicker() {
        const host = this.shadowRoot.getElementById('trigger-editor');
        if (!host) return;
        host.replaceChildren();
        this._cardPicker = document.createElement('hui-card-picker');
        this._cardPicker.hass = this._hass;
        this._cardPicker.lovelace = this._lovelace;
        this._cardPicker.addEventListener('config-changed', (event) => {
          event.stopPropagation();
          this._triggerConfig = event.detail.config;
          this._renderTriggerEditor();
          this._emitConfig();
        });
        host.appendChild(this._cardPicker);
      }

      _schedulePreviewRefresh() {
        clearTimeout(this._previewTimer);
        this._previewTimer = window.setTimeout(() => this._refreshPreview(), 180);
      }

      async _refreshPreview() {
        const frame = this.shadowRoot.getElementById('preview-frame');
        if (!frame) return;
        const version = ++this._previewVersion;
        this._previewCard = null;
        frame.replaceChildren();

        if (this._popup.title && !this._popup.hide_border && !this._popup.hide_title_bar) {
          const title = document.createElement('div');
          title.className = 'preview-title';
          title.textContent = this._popup.title;
          frame.appendChild(title);
        }
        const cardConfig = this._popup.cards.length === 1
          ? this._popup.cards[0]
          : this._popup.cards.length > 1
            ? { type: 'vertical-stack', cards: this._popup.cards }
            : null;

        if (!cardConfig) {
          const empty = document.createElement('div');
          empty.className = 'preview-empty';
          empty.textContent = '尚未添加弹窗卡片';
          frame.appendChild(empty);
          return;
        }

        try {
          const helpers = await window.loadCardHelpers?.();
          if (!helpers || !this.isConnected || version !== this._previewVersion) return;
          const card = await helpers.createCardElement(cardConfig);
          if (!this.isConnected || version !== this._previewVersion) return;
          card.hass = this._hass;
          card.lovelace = this._lovelace;
          this._previewCard = card;
          frame.appendChild(card);
        } catch (error) {
          if (!this.isConnected || version !== this._previewVersion) return;
          const message = document.createElement('div');
          message.className = 'preview-empty';
          message.textContent = `预览加载失败：${error.message}`;
          frame.appendChild(message);
        }
      }

      _emitConfig() {
        const config = {
          ...this._config,
          card: this._triggerConfig,
          popup: {
            title: this._popup.title,
            hide_border: this._popup.hide_border,
            hide_title_bar: this._popup.hide_title_bar,
            mobile_sheet: this._popup.mobile_sheet,
            takeover_click: this._popup.takeover_click,
            click_exclude: this._popup.click_exclude,
            jump_enabled: this._popup.jump_enabled,
            jump_path: this._popup.jump_path,
            cards: [...this._popup.cards]
          },
          popup_trigger: this._triggerAction
        };
        delete config.title;
        delete config.hide_header;
        this._config = config;
        this._schedulePreviewRefresh();
        this.dispatchEvent(new CustomEvent('config-changed', {
          bubbles: true,
          composed: true,
          detail: { config }
        }));
      }
    }

    customElements.define('popup-card-editor', PopupCardEditor);
  }

  // ========================================
  // PopupCard 类定义
  // ========================================
  class PopupCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement('popup-card-editor');
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._hass = null;
      this._currentTheme = 'light';
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._triggerElement) return;

      let previousGridOptions;
      try {
        previousGridOptions = JSON.stringify(this._triggerElement.getGridOptions?.());
      } catch (_error) {
        // 某些自定义卡片需要运行时上下文后才会提供网格尺寸信息。
      }
      this._triggerElement.hass = hass;

      let nextGridOptions;
      try {
        nextGridOptions = JSON.stringify(this._triggerElement.getGridOptions?.());
      } catch (_error) {
        // 将状态更新与可选的尺寸接口解耦。
      }
      if (previousGridOptions !== undefined && nextGridOptions !== undefined
        && previousGridOptions !== nextGridOptions) {
        this._notifyCardUpdated();
      }
    }

    _notifyCardUpdated() {
      this.dispatchEvent(new CustomEvent('card-updated', {
        bubbles: true,
        composed: true
      }));
    }

    get hass() {
      return this._hass;
    }

    set layout(layout) {
      this._layout = layout;
      if (this._triggerElement) this._triggerElement.layout = layout;
    }

    get layout() {
      return this._layout;
    }

    setConfig(config) {
      // 标准格式中，顶层 card 是触发卡，popup.cards 是弹窗内容。
      if (config.popup && config.card) {
        this._triggerCardConfig = config.card;
        this._popupConfig = config.popup;
      } else if (config.popup) {
        throw new Error('缺少触发卡片配置：请保留顶层 card 字段，或在可视化编辑器中选择触发卡片。');
      } else if (config.card) {
        this._triggerCardConfig = {
          type: 'shortcut',
          tap_action: { action: 'none' },
          vertical: false,
          label: '打开弹窗'
        };
        this._popupConfig = config;
      } else {
        throw new Error('缺少触发卡片和弹窗内容配置。');
      }
      let popupCards = this._popupConfig.cards;
      if (!Array.isArray(popupCards)) {
        const popupCard = this._popupConfig.card;
        popupCards = !popupCard ? [] : Array.isArray(popupCard)
          ? popupCard
          : popupCard.type === 'vertical-stack' && Array.isArray(popupCard.cards)
            ? popupCard.cards
            : [popupCard];
      }
      this._popupConfig = {
        title: this._popupConfig.title,
        hide_border: this._popupConfig.hide_border ?? this._popupConfig.hide_header,
        hide_title_bar: this._popupConfig.hide_title_bar === true,
        mobile_sheet: this._popupConfig.mobile_sheet === true,
        takeover_click: this._popupConfig.takeover_click !== false,
        click_exclude: typeof this._popupConfig.click_exclude === 'string' ? this._popupConfig.click_exclude : '',
        jump_enabled: this._popupConfig.jump_enabled === true,
        jump_path: typeof this._popupConfig.jump_path === 'string' ? this._popupConfig.jump_path : '',
        cards: [...popupCards]
      };
      this._popupTrigger = config.popup_trigger || config.popup?.trigger || 'tap';
      this._takeoverClick = this._popupConfig.takeover_click;
      this._clickExclude = this._popupConfig.click_exclude;
      this.config = config;
      if (this.isConnected) this.render();
    }

    connectedCallback() {
      this.render();
    }

    disconnectedCallback() {
      this._clearTriggerHandlers();
    }

    _clearTriggerHandlers() {
      if (this._triggerActionHandler) this.removeEventListener('hass-action', this._triggerActionHandler, true);
      if (this._triggerActionHandler) this.removeEventListener('action', this._triggerActionHandler, true);
      if (this._triggerPointerDown) {
        this.removeEventListener('mousedown', this._triggerPointerDown, true);
        this.removeEventListener('touchstart', this._triggerPointerDown, true);
        this.removeEventListener('pointerdown', this._triggerPointerDown, true);
      }
      if (this._triggerPointerUp) {
        this.removeEventListener('mouseup', this._triggerPointerUp, true);
        this.removeEventListener('touchend', this._triggerPointerUp, true);
        this.removeEventListener('pointerup', this._triggerPointerUp, true);
      }
      if (this._triggerPointerCancel) this.removeEventListener('touchcancel', this._triggerPointerCancel, true);
      if (this._triggerPointerCancel) this.removeEventListener('pointercancel', this._triggerPointerCancel, true);
      if (this._triggerClickFallback) this.removeEventListener('click', this._triggerClickFallback, true);
      for (const [eventName, handler] of this._documentTriggerHandlers || []) {
        document.removeEventListener(eventName, handler, true);
      }
      this._documentTriggerHandlers = [];
      // 部分原生卡会在自身 Shadow DOM 内阻止非 composed 事件，
      // 因此也在卡片宿主上移除相同的捕获监听器。
      const card = this._triggerElement;
      if (card) {
        if (this._triggerActionHandler) card.removeEventListener('hass-action', this._triggerActionHandler, true);
        if (this._triggerActionHandler) card.removeEventListener('action', this._triggerActionHandler, true);
        if (this._triggerPointerDown) {
          card.removeEventListener('mousedown', this._triggerPointerDown, true);
          card.removeEventListener('touchstart', this._triggerPointerDown, true);
          card.removeEventListener('pointerdown', this._triggerPointerDown, true);
        }
        if (this._triggerPointerUp) {
          card.removeEventListener('mouseup', this._triggerPointerUp, true);
          card.removeEventListener('touchend', this._triggerPointerUp, true);
          card.removeEventListener('pointerup', this._triggerPointerUp, true);
        }
        if (this._triggerPointerCancel) {
          card.removeEventListener('touchcancel', this._triggerPointerCancel, true);
          card.removeEventListener('pointercancel', this._triggerPointerCancel, true);
        }
        if (this._triggerClickFallback) card.removeEventListener('click', this._triggerClickFallback, true);
      }
      clearTimeout(this._holdMarkTimer);
      clearTimeout(this._tapClickTimer);
      clearTimeout(this._doubleTapTimer);
      clearTimeout(this._interactiveResetTimer);
      clearTimeout(this._skipClickTimer);
      this._pointerDownAt = null;
      this._pointerHeld = false;
      this._gestureInteractive = false;
      this._rippleReleasePending = false;
      this._suppressTapUntil = 0;
      this._lastPopupTriggerAt = 0;
    }

    async render() {
      this._clearTriggerHandlers();
      const renderVersion = (this._renderVersion || 0) + 1;
      this._renderVersion = renderVersion;
      if (this._triggerCardConfig) {
        this.shadowRoot.innerHTML = `
          <style>
            :host { display: block; height: 100%; min-height: 0; }
            #trigger-card { height: 100%; min-height: 0; }
            #trigger-card > * { height: 100%; }
          </style>
          <div id="trigger-card"></div>`;
        const container = this.shadowRoot.getElementById('trigger-card');
        try {
          const helpers = await window.loadCardHelpers?.();
          if (!helpers || !this.isConnected || renderVersion !== this._renderVersion) return;
          // 保留卡片原有的点击动作，使开关、滑块和按钮区域继续执行原生操作。
          // 包装卡拦截选定的动作；没有发出 hass-action 的卡片由点击回退逻辑处理。
          const nativeActionKey = {
            tap: 'tap_action',
            hold: 'hold_action',
            double_tap: 'double_tap_action',
          }[this._popupTrigger];
          const originalActionConfig = nativeActionKey && this._triggerCardConfig[nativeActionKey];
          const triggerAction = this._popupTrigger === 'tap'
            ? (originalActionConfig || { action: 'more-info' })
            : { action: 'more-info' };
          const runtimeTriggerConfig = { ...this._triggerCardConfig };
          if (nativeActionKey) runtimeTriggerConfig[nativeActionKey] = triggerAction;
          this._triggerElement = await helpers.createCardElement(runtimeTriggerConfig);
          if (!this.isConnected || renderVersion !== this._renderVersion) return;
          this._triggerElement.layout = this._layout;
          if (this._hass) this._triggerElement.hass = this._hass;
          container.appendChild(this._triggerElement);
          const openPopup = () => {
            const popup = this._popupConfig;
            window.GlobalPopupController.show({
              card: popup.cards.length === 1
                ? popup.cards[0]
                : { type: 'vertical-stack', cards: popup.cards },
              title: popup.title,
              hide_border: popup.hide_border,
              hide_title_bar: popup.hide_title_bar,
              mobile_sheet: popup.mobile_sheet,
              jump_enabled: popup.jump_enabled,
              jump_path: popup.jump_path
            });
          };
          const replayClicks = (target, details) => {
            if (!target?.isConnected) return;
            this._replayingTriggerClick = true;
            try {
              for (const detail of details) {
                target.dispatchEvent(new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  detail
                }));
              }
            } finally {
              this._replayingTriggerClick = false;
            }
          };
          const suppressNextClick = () => {
            this._skipNextClickFallback = true;
            clearTimeout(this._skipClickTimer);
            this._skipClickTimer = window.setTimeout(() => {
              this._skipNextClickFallback = false;
              this._rippleReleasePending = false;
              this._skipClickTimer = null;
            }, 800);
          };
          this._isInteractiveEvent = (event) => {
            const builtIn = [
              'input', 'select', 'textarea',
              '[role="switch"]', '[role="slider"]', '[role="checkbox"]',
              '[role="radio"]', '[role="spinbutton"]', '[contenteditable="true"]',
              '[data-popup-card-interactive]',
              'ha-switch', 'ha-slider', 'ha-control-slider',
              'ha-control-number', 'ha-control-select', 'ha-control-switch', 'ha-entity-toggle',
              'ha-combo-box', 'ha-selector', 'ha-textfield', 'ha-checkbox', 'ha-radio',
              'mushroom-control-slider', 'mushroom-light-brightness-control'
            ];
            const configured = (this._clickExclude || '')
              .split(',').map((selector) => selector.trim()).filter(Boolean);
            const selectors = [...builtIn, ...configured];
            const candidates = new Set();
            const addAncestors = (node) => {
              let element = node?.nodeType === 1 ? node : node?.parentElement;
              const visited = new Set();
              while (element && !visited.has(element)) {
                visited.add(element);
                candidates.add(element);
                // 同时遍历插槽、Shadow DOM 宿主和普通父元素，
                // 以便排除 ha-tile-info 等容器，即使卡片重定向了事件。
                const root = element.getRootNode?.();
                element = element.assignedSlot || element.parentElement || root?.host || null;
              }
            };

            for (const node of event.composedPath?.() || [event.target]) addAncestors(node);

            // 部分移动端或原生卡会将指针事件重定向到宿主元素。
            // 根据事件坐标查找实际命中元素，并在浏览器允许时深入开放的 Shadow DOM。
            const point = event.changedTouches?.[0] || event.touches?.[0] || event;
            if (Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY)) {
              let hit = document.elementFromPoint(point.clientX, point.clientY);
              const descended = new Set();
              while (hit && !descended.has(hit)) {
                descended.add(hit);
                addAncestors(hit);
                let shadowHit = null;
                try {
                  shadowHit = hit.shadowRoot?.elementFromPoint?.(point.clientX, point.clientY) || null;
                } catch (_error) {
                  // 对于封闭或不支持的 Shadow DOM，普通命中结果会返回其宿主元素。
                }
                if (!shadowHit || shadowHit === hit) break;
                hit = shadowHit;
              }

              // 若浏览器将事件重定向到卡片宿主，composedPath 可能只包含宿主。
              // 此时遍历触发卡的开放 Shadow DOM，并以排除元素的可见区域补充命中判断。
              const roots = [this._triggerElement, this._triggerElement?.shadowRoot].filter(Boolean);
              const visitedRoots = new Set();
              while (roots.length) {
                const root = roots.pop();
                if (!root || visitedRoots.has(root)) continue;
                visitedRoots.add(root);
                for (const selector of configured) {
                  try {
                    for (const excludedElement of root.querySelectorAll(selector)) {
                      const rect = excludedElement.getBoundingClientRect();
                      if (point.clientX >= rect.left && point.clientX <= rect.right &&
                          point.clientY >= rect.top && point.clientY <= rect.bottom) {
                        return true;
                      }
                    }
                  } catch (_error) {
                    // 忽略无效选择器，其余有效选择器仍继续生效。
                  }
                }
                for (const element of root.querySelectorAll('*')) {
                  if (element.shadowRoot) roots.push(element.shadowRoot);
                }
              }
            }

            return [...candidates].some((element) => selectors.some((selector) => {
              try {
                return element.matches(selector);
              } catch (_error) {
                return false;
              }
            }));
          };
          this._seenTriggerEvents = new WeakSet();
          this._isFirstTriggerEvent = (event) => {
            if (!event || this._seenTriggerEvents.has(event)) return false;
            this._seenTriggerEvents.add(event);
            return true;
          };
          // 三种手势统一由此路由处理：选定的手势打开弹窗，其余动作保留原生行为。
          this._routeTriggerGesture = (action, event, passThrough) => {
            if (action !== this._popupTrigger) {
              passThrough?.();
              return false;
            }
            if (event?.cancelable) event.preventDefault();
            event?.stopImmediatePropagation();
            // 指针/触摸识别和卡片的 hass-action 可能报告同一次手势。
            // 两种信号都拦截，但只打开一次弹窗。
            const now = Date.now();
            if (now - (this._lastPopupTriggerAt || 0) < 600) return true;
            this._lastPopupTriggerAt = now;
            openPopup();
            return true;
          };
          this._triggerActionHandler = (event) => {
            if (!this._isFirstTriggerEvent(event)) return;
            const action = event.detail?.action;
            if (this._replayingTriggerClick) return;
            // 长按释放时让 click 到达原卡片以清理涟漪，同时拦截附带的单击动作。
            if (action === 'tap' && Date.now() < (this._suppressTapUntil || 0)) {
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            if (this._gestureInteractive || this._isInteractiveEvent(event)) return;
            // 原生点击动作应在合成 click 到达前优先路由。
            // 点击回退会拦截该 click，确保弹窗只打开一次。
            // 触屏设备及不发送 hass-action 的卡片继续使用下方回退逻辑。
            if (action === 'tap' && this._popupTrigger === 'tap' && this._takeoverClick) {
              if (this._pointerHeld) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
              }
              clearTimeout(this._tapClickTimer);
              this._tapClickTimer = null;
              suppressNextClick();
              this._routeTriggerGesture('tap', event);
              return;
            }
            if (action === 'hold' && this._popupTrigger === 'hold' && this._takeoverClick) {
              // 先接管原生长按动作，等指针释放及涟漪收尾后再打开弹窗。
              event.preventDefault();
              event.stopImmediatePropagation();
              suppressNextClick();
              return;
            }
            if (this._popupTrigger === 'tap' && action === 'double_tap') {
              clearTimeout(this._tapClickTimer);
              this._tapClickTimer = null;
              suppressNextClick();
            }
            if (this._popupTrigger === 'double_tap' && action === 'tap') {
              // 原生单击已经处理，回退计时结束时不要重复发送同一次点击。
              this._nativeTapSinceClick = true;
            }
            if (action === 'double_tap' && this._popupTrigger === 'double_tap') {
              clearTimeout(this._doubleTapTimer);
              this._doubleTapTimer = null;
              suppressNextClick();
            }
            this._routeTriggerGesture(action, event);
          };
          this._triggerPointerDown = (event) => {
            if (!this._isFirstTriggerEvent(event)) return;
            if (event.type === 'touchstart' || (event.type === 'pointerdown' && event.pointerType === 'touch')) this._lastTouchAt = Date.now();
            if (event.type === 'mousedown' && Date.now() - (this._lastTouchAt || 0) < 800) return;
            if (event.type === 'pointerdown' && event.pointerType === 'mouse' && Date.now() - (this._lastTouchAt || 0) < 800) return;
            this._gestureInteractive = this._isInteractiveEvent(event);
            if (this._gestureInteractive) {
              this._pointerDownAt = null;
              this._pointerHeld = false;
              clearTimeout(this._holdMarkTimer);
              clearTimeout(this._interactiveResetTimer);
              this._interactiveResetTimer = window.setTimeout(() => {
                this._gestureInteractive = false;
                this._interactiveResetTimer = null;
              }, 500);
              return;
            }
            this._pointerDownAt = Date.now();
            this._pointerHeld = false;
            this._skipNextClickFallback = false;
            clearTimeout(this._holdMarkTimer);
            this._holdMarkTimer = window.setTimeout(() => {
              this._pointerHeld = true;
            }, 500);
          };
          this._triggerPointerUp = (event) => {
            if (!this._isFirstTriggerEvent(event)) return;
            if (event.type === 'touchend' || (event.type === 'pointerup' && event.pointerType === 'touch')) this._lastTouchAt = Date.now();
            if (event.type === 'touchend' && Date.now() < (this._suppressTouchEndUntil || 0)) {
              event.preventDefault();
              // 让卡片涟漪效果收到抬起事件；语义动作仍由 hass-action 单独拦截。
              return;
            }
            if (event.type === 'mouseup' && Date.now() - (this._lastTouchAt || 0) < 800) return;
            if (event.type === 'pointerup' && event.pointerType === 'mouse' && Date.now() - (this._lastTouchAt || 0) < 800) return;
            if (this._gestureInteractive) return;
            if (this._pointerDownAt == null) return;
            const held = this._pointerHeld || Date.now() - this._pointerDownAt >= 500;
            this._pointerDownAt = null;
            this._pointerHeld = held;
            clearTimeout(this._holdMarkTimer);
            if (!held && this._takeoverClick && this._popupTrigger === 'tap') {
              // 路由手势时仍允许 pointerup 传给 ha-ripple 等视觉反馈组件，清除按下状态。
              // 原生动作由 document 级 hass-action 监听器拦截，兼容 click 则由回退逻辑拦截。
              event.preventDefault();
              suppressNextClick();
              const clickTarget = event.composedPath?.()[0] || event.target;
              if (this._tapClickTimer) {
                clearTimeout(this._tapClickTimer);
                this._tapClickTimer = null;
                this._routeTriggerGesture('double_tap', event, () => replayClicks(clickTarget, [1, 2]));
              } else {
                this._tapClickTimer = window.setTimeout(() => {
                  this._tapClickTimer = null;
                  if (this.isConnected) this._routeTriggerGesture('tap');
                }, 300);
              }
              this._pointerHeld = false;
              return;
            }
            if (!held && this._takeoverClick && this._popupTrigger === 'double_tap') {
              if ((event.type === 'pointerup' && event.pointerType === 'touch') || event.type === 'touchend') {
                this._suppressTouchEndUntil = Date.now() + 800;
              }
              event.preventDefault();
              event.stopImmediatePropagation();
              suppressNextClick();
              const clickTarget = event.composedPath?.()[0] || event.target;
              if (this._doubleTapTimer) {
                clearTimeout(this._doubleTapTimer);
                this._doubleTapTimer = null;
                this._routeTriggerGesture('double_tap', event);
              } else {
                this._doubleTapTimer = window.setTimeout(() => {
                  this._doubleTapTimer = null;
                  if (this.isConnected) {
                    this._routeTriggerGesture('tap', null, () => replayClicks(clickTarget, [1]));
                  }
                }, 300);
              }
              this._pointerHeld = false;
              return;
            }
            if (held && this._popupTrigger === 'hold' && this._takeoverClick) {
              if (event.type === 'pointerup' && event.pointerType === 'touch') {
                this._suppressTouchEndUntil = Date.now() + 800;
              }
              this._rippleReleasePending = true;
              this._suppressTapUntil = Date.now() + 800;
              suppressNextClick();
              // 让抬起及后续 click 先到达 ha-ripple，结束原生按压动画；
              // 下一轮任务再打开弹窗，避免弹窗插入打断卡片的收尾过程。
              window.setTimeout(() => {
                if (this.isConnected) this._routeTriggerGesture('hold', null);
              }, 0);
              window.setTimeout(() => { this._pointerHeld = false; }, 0);
            }
          };
          this._triggerClickFallback = (event) => {
            if (!this._isFirstTriggerEvent(event)) return;
            if (this._replayingTriggerClick) return;
            if (this._gestureInteractive || this._isInteractiveEvent(event)) {
              // 在 click 后续触发原生 hass-action 期间保留交互标记。
              // 若在此捕获阶段清除，卡片之后发出的动作事件会打开弹窗。
              if (this._gestureInteractive) {
                clearTimeout(this._interactiveResetTimer);
                this._interactiveResetTimer = window.setTimeout(() => {
                  this._gestureInteractive = false;
                  this._interactiveResetTimer = null;
                }, 500);
              }
              return;
            }
            if (!this._takeoverClick) return;
            if (this._skipNextClickFallback) {
              this._skipNextClickFallback = false;
              clearTimeout(this._skipClickTimer);
              this._skipClickTimer = null;
              event.preventDefault();
              if (this._rippleReleasePending) {
                this._rippleReleasePending = false;
                this._suppressTapUntil = 0;
                return;
              }
              event.stopImmediatePropagation();
              return;
            }
            if (this._popupTrigger === 'tap') {
              if (this._pointerHeld) {
                // 保留未选中的原生长按动作，并忽略长按后跟随的合成 click。
                window.setTimeout(() => { this._pointerHeld = false; }, 0);
                return;
              }
              // 短暂等待以保留触发卡的双击；单击模式下只有独立单击打开弹窗。
              event.preventDefault();
              event.stopImmediatePropagation();
              const clickTarget = event.composedPath?.()[0] || event.target;
              if (this._tapClickTimer) {
                clearTimeout(this._tapClickTimer);
                this._tapClickTimer = null;
                this._routeTriggerGesture('double_tap', event, () => replayClicks(clickTarget, [1, 2]));
                return;
              }
              this._tapClickTimer = window.setTimeout(() => {
                this._tapClickTimer = null;
                if (this.isConnected) this._routeTriggerGesture('tap');
              }, 300);
              return;
            }
            if (this._pointerHeld) {
              // 仅长按模式会接管长按；单击和双击模式保留子卡片的原生长按行为。
              this._pointerHeld = false;
              if (this._popupTrigger !== 'hold') return;
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            if (this._popupTrigger !== 'double_tap') return;

            // 由此统一判断双击：先暂存第一次点击。
            // 双击间隔内没有第二次点击时，将第一次点击回放给子卡片；
            // 收到第二次点击则打开弹窗，两次点击都不再传给子卡片。
            event.preventDefault();
            event.stopImmediatePropagation();
            const clickTarget = event.composedPath?.()[0] || event.target;
            if (this._doubleTapTimer) {
              clearTimeout(this._doubleTapTimer);
              this._doubleTapTimer = null;
              this._routeTriggerGesture('double_tap', event);
              return;
            }
              this._doubleTapTimer = window.setTimeout(() => {
                this._doubleTapTimer = null;
                if (this._nativeTapSinceClick) {
                  this._nativeTapSinceClick = false;
                  return;
                }
                if (!this.isConnected) return;
                this._routeTriggerGesture('tap', null, () => replayClicks(clickTarget, [1]));
              }, 300);
          };
          this._triggerPointerCancel = (event) => {
            if (!this._isFirstTriggerEvent(event)) return;
            this._pointerDownAt = null;
            this._pointerHeld = false;
            this._gestureInteractive = false;
            clearTimeout(this._holdMarkTimer);
          };
          this.addEventListener('hass-action', this._triggerActionHandler, true);
          this.addEventListener('action', this._triggerActionHandler, true);
          // 使用与 HA 动作处理器相同的输入事件，
          // 以便在不暴露 composed 指针事件的客户端中也能识别长按时长。
          this.addEventListener('mousedown', this._triggerPointerDown, true);
          this.addEventListener('mouseup', this._triggerPointerUp, true);
          this.addEventListener('pointerdown', this._triggerPointerDown, true);
          this.addEventListener('pointerup', this._triggerPointerUp, true);
          this.addEventListener('pointercancel', this._triggerPointerCancel, true);
          this.addEventListener('touchstart', this._triggerPointerDown, true);
          this.addEventListener('touchend', this._triggerPointerUp, true);
          this.addEventListener('touchcancel', this._triggerPointerCancel, true);
          this.addEventListener('click', this._triggerClickFallback, true);
          // 同时在卡片宿主捕获事件，确保其 Shadow DOM 发出的非 composed 事件也进入同一路由。
          this._triggerElement.addEventListener('hass-action', this._triggerActionHandler, true);
          this._triggerElement.addEventListener('action', this._triggerActionHandler, true);
          this._triggerElement.addEventListener('mousedown', this._triggerPointerDown, true);
          this._triggerElement.addEventListener('mouseup', this._triggerPointerUp, true);
          this._triggerElement.addEventListener('pointerdown', this._triggerPointerDown, true);
          this._triggerElement.addEventListener('pointerup', this._triggerPointerUp, true);
          this._triggerElement.addEventListener('pointercancel', this._triggerPointerCancel, true);
          this._triggerElement.addEventListener('touchstart', this._triggerPointerDown, true);
          this._triggerElement.addEventListener('touchend', this._triggerPointerUp, true);
          this._triggerElement.addEventListener('touchcancel', this._triggerPointerCancel, true);
          this._triggerElement.addEventListener('click', this._triggerClickFallback, true);
          // 在原生卡处理指针、触摸、click 或 hass-action 前于 document 级捕获事件。
          // 所有监听器仅作用于当前触发卡，不影响仪表盘其他控件。
          const pathScoped = (handler) => (event) => {
            if ((event.composedPath?.() || []).includes(this._triggerElement)) handler(event);
          };
          const documentHandlers = [
            ['hass-action', this._triggerActionHandler],
            ['action', this._triggerActionHandler],
            ['mousedown', this._triggerPointerDown],
            ['mouseup', this._triggerPointerUp],
            ['pointerdown', this._triggerPointerDown],
            ['pointerup', this._triggerPointerUp],
            ['pointercancel', this._triggerPointerCancel],
            ['touchstart', this._triggerPointerDown],
            ['touchend', this._triggerPointerUp],
            ['touchcancel', this._triggerPointerCancel],
            ['click', this._triggerClickFallback]
          ];
          this._documentTriggerHandlers = documentHandlers.map(([eventName, callback]) => {
            const handler = pathScoped(callback);
            document.addEventListener(eventName, handler, true);
            return [eventName, handler];
          });

          // HA 可能在嵌套卡片及其 hass 状态准备就绪前已测量此包装区域。
          // 重新构建一次分区，使其采用已初始化卡片的实时网格选项，而非初始回退尺寸。
          this._notifyCardUpdated();
        } catch (error) {
          console.error('[popup_card] 创建触发卡失败:', error);
          container.textContent = '触发卡加载失败，请检查卡片配置。';
        }
        return;
      }

      this.shadowRoot.innerHTML = '<div class="popup-card-error">缺少触发卡片配置。请在编辑器中选择触发卡片，或检查 YAML 顶层的 card 字段。</div>';
    }

    getCardSize() {
      return this._triggerElement?.getCardSize?.() ?? 2;
    }

    // 分区仪表盘使用此值确定卡片默认占位和布局编辑器允许的最小尺寸。
    getGridOptions() {
      const outerOptions = {
        columns: 6,
        min_columns: 1,
      };
      const explicitRows = this.config?.grid_options?.rows
        ?? this._triggerCardConfig?.grid_options?.rows;
      if (explicitRows !== undefined) {
        const childOptions = this._triggerElement?.getGridOptions?.() || {};
        return { ...outerOptions, ...childOptions, rows: explicitRows };
      }

      // 尽可能使用正在运行的子卡片实例。
      const liveOptions = this._triggerElement?.getGridOptions?.();
      if (liveOptions && typeof liveOptions === 'object') {
        return { ...outerOptions, ...liveOptions };
      }

      // 触发卡片创建前，使用已配置的卡片实例作为初始回退，
      // 并传入 hass，让依赖状态的卡片从一开始就能正确计算尺寸。
      const cardType = this._triggerCardConfig?.type;
      if (typeof cardType === 'string') {
        const elementType = cardType.startsWith('custom:')
          ? cardType.slice('custom:'.length)
          : `hui-${cardType}-card`;
        const CardClass = customElements.get(elementType);
        if (CardClass?.prototype?.getGridOptions) {
          try {
            const card = document.createElement(elementType);
            card.setConfig?.(this._triggerCardConfig);
            if (this._hass) card.hass = this._hass;
            card.layout = this._layout;
            const childOptions = card.getGridOptions();
            if (childOptions && typeof childOptions === 'object') {
              return { ...outerOptions, ...childOptions };
            }
          } catch (_error) {
            // 触发卡片可能需要运行时上下文；此时使用卡片自身尺寸，避免强制设定固定行高。
          }
        }
      }

      return outerOptions;
    }

    static getStubConfig() {
      return {
        card: {
          type: 'shortcut',
          tap_action: { action: 'none' },
          vertical: false,
          label: '打开弹窗'
        },
        popup_trigger: 'tap',
        popup: {
          title: '',
          hide_border: false,
          hide_title_bar: false,
          mobile_sheet: false,
          takeover_click: false,
          click_exclude: '',
          jump_enabled: false,
          jump_path: '',
          cards: []
        }
      };
    }
  }

  // ========================================
  // 注册自定义元素
  // ========================================
  try {
    if (!customElements.get('popup-card')) {
      customElements.define('popup-card', PopupCard);
      popupCardLog('[popup_card] ✓ popup-card 已注册');
    } else {
      popupCardLog('[popup_card] ℹ️ popup-card 已存在，跳过注册');
    }
  } catch (error) {
    console.error('[popup_card] ✗ 注册失败:', error);
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.some(card => card.type === 'popup-card')) {
    window.customCards.push({
      type: 'popup-card',
      name: '弹窗卡片',
      description: '包装任意卡片，点击后打开配置的弹窗'
    });
  }

  // ========================================
  // 全局弹窗控制器
  // ========================================
  window.GlobalPopupController = {
    hass: null,
    _popupStack: [],
    _escHandler: null,
    _popstateHandler: null,
    _historyOwner: `popup-card-${Math.random().toString(36).slice(2)}`,
    _hassUnsubscribe: null,
    _updatePending: false,
    _hassVersion: 0,
    _retryTimers: [],       // 追踪所有重试定时器
    _cardCache: new Map(),  // 卡片元素缓存 (LRU, 最大5条)
    _isVisible: true,       // 页面是否可见
    _staleUpdate: false,    // 页面不可见期间是否有待处理的更新

    init() {
      popupCardLog('[popup_card] GlobalPopupController 初始化');
      this._startHassWatcher();
    },

    // 从卡片配置中递归提取所有关联的实体ID
    _extractEntities(config) {
      const entities = new Set();
      if (!config || typeof config !== 'object') return entities;

      if (config.entity) {
        entities.add(config.entity);
      }
      if (config.entities) {
        const list = Array.isArray(config.entities) ? config.entities : Object.keys(config.entities);
        list.forEach(e => {
          if (typeof e === 'string') entities.add(e);
          else if (e && e.entity) entities.add(e.entity);
        });
      }
      if (config.cards) {
        config.cards.forEach(c => this._extractEntities(c).forEach(e => entities.add(e)));
      }
      if (config.elements) {
        Object.values(config.elements).forEach(el => {
          if (el && typeof el === 'object') {
            this._extractEntities(el).forEach(e => entities.add(e));
          }
        });
      }

      return entities;
    },

    // 生成卡片配置对应的缓存标识
    _cacheKey(cardConfig) {
      return JSON.stringify(cardConfig);
    },

    // 从缓存获取卡片元素（优先使用最近访问的项目）
    _getCachedCard(cardConfig) {
      const key = this._cacheKey(cardConfig);
      const cached = this._cardCache.get(key);
      if (cached && cached.cardElement) {
        this._cardCache.delete(key);
        this._cardCache.set(key, cached);
        return cached.cardElement;
      }
      return null;
    },

    // 将卡片元素存入缓存 (超出上限时淘汰最旧的)
    _cacheCard(cardConfig, cardElement) {
      const key = this._cacheKey(cardConfig);
      this._cardCache.delete(key);

      if (this._cardCache.size >= 5) {
        const oldestKey = this._cardCache.keys().next().value;
        this._cardCache.delete(oldestKey);
      }

      this._cardCache.set(key, { cardElement });
    },

    // 清空卡片缓存
    _clearCardCache() {
      this._cardCache.clear();
    },

    // 订阅 hass 状态变化
    _startHassWatcher() {
      const haRoot = document.querySelector('home-assistant');
      const hass = haRoot?.hass || haRoot?.shadowRoot?.querySelector('home-assistant-main')?.hass;

      if (!hass || !hass.connection) {
        const timer = setTimeout(() => this._startHassWatcher(), 500);
        this._retryTimers.push(timer);
        return;
      }

      this.hass = hass;

      try {
        hass.connection.subscribeMessage(
          (msg) => {
            if (this._popupStack.length === 0) return;

            const entityId = msg.data?.entity_id;
            if (!entityId) return;

            // 检查是否有弹窗关心这个实体的变化
            const needsUpdate = this._popupStack.some(popupInfo => {
              const tracked = popupInfo._trackedEntities;
              // 未追踪或追踪了该实体时需要更新
              return !tracked || tracked.size === 0 || tracked.has(entityId);
            });

            if (!needsUpdate) return;

            // 使用逐帧回调批处理，合并同一帧内的多次状态变化
            this._scheduleUpdate();
          },
          { type: 'subscribe_events', event_type: 'state_changed' }
        ).then((unsub) => {
          this._hassUnsubscribe = unsub;
          popupCardLog('[popup_card] 已订阅 hass 状态变化（优化模式：实体过滤 + RAF批处理）');
        });
      } catch (err) {
        console.error('[popup_card] 订阅状态变化失败:', err);
      }
    },

    // 安排逐帧批处理，每帧最多更新一次
    _scheduleUpdate() {
      if (this._updatePending) return;
      // 页面不可见时标记为待更新，回来后统一处理
      if (!this._isVisible) {
        this._staleUpdate = true;
        return;
      }
      this._updatePending = true;
      requestAnimationFrame(() => {
        this._updatePending = false;
        const haRoot = document.querySelector('home-assistant');
        const newHass = haRoot?.hass || haRoot?.shadowRoot?.querySelector('home-assistant-main')?.hass;

        // HA 状态对象未变化时跳过（HA 通常会在状态变化时更新对象引用）
        if (newHass === this.hass) return;
        this.hass = newHass;
        this._updateAllCards();
      });
    },

    // 只更新需要刷新的弹窗卡片
    _updateAllCards() {
      this._popupStack.forEach(popupInfo => {
        if (popupInfo.cardElement && this.hass) {
          try {
            popupInfo.cardElement.hass = this.hass;
          } catch (err) {
            // 卡片可能已销毁，从栈中标记移除
            console.warn('[popup_card] 更新卡片失败，可能已销毁:', err.message);
          }
        }
      });
    },

    async show(options) {
      popupCardLog('[popup_card] 显示弹窗:', options);

      const { card, title } = options;
      const hideBorder = options.hide_border === true || options.hide_header === true;
      const hideTitleBar = options.hide_title_bar === true;
      const jumpEnabled = options.jump_enabled === true;
      const jumpPath = typeof options.jump_path === 'string' ? options.jump_path.trim() : '';

      // 检测是否为移动端
      const isMobile = window.innerWidth < 768;
      const mobileSheet = isMobile && options.mobile_sheet === true;

      // 弹窗内容为空时，在普通和无边框模式下都显示提示并可操作，
      // 不直接渲染空堆叠卡。
      const hasPopupCards = Array.isArray(card)
        ? card.length > 0
        : !!card && !(card.type === 'vertical-stack' && (!Array.isArray(card.cards) || card.cards.length === 0));
      let cardConfig = hasPopupCards ? card : {
        type: 'markdown',
        content: '<center><b>尚未配置弹窗卡片</b><br><br>请在卡片编辑器中添加弹窗内容</center>'
      };
      if (Array.isArray(cardConfig)) {
        cardConfig = { type: 'vertical-stack', cards: cardConfig };
      }

      // 计算正确的显示层级
      const baseZ = 1000 + this._popupStack.length * 10;
      const overlayZIndex = baseZ;
      const zIndex = baseZ + 5;

      // 创建遮罩层
      const overlay = document.createElement('div');
      overlay.className = 'popup-card-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--mdc-dialog-scrim-color, rgba(0, 0, 0, 0.32));
        z-index: ${overlayZIndex};
        -webkit-backdrop-filter: var(--ha-dialog-scrim-backdrop-filter, var(--dialog-backdrop-filter, none));
        backdrop-filter: var(--ha-dialog-scrim-backdrop-filter, var(--dialog-backdrop-filter, none));
        ${mobileSheet ? 'touch-action: none;' : ''}
      `;

      if (mobileSheet) {
        // 遮罩上的触摸滚动默认会滚动页面底层；只拦截从遮罩开始的手势。
        overlay.addEventListener('touchmove', (event) => {
          if (event.target === overlay) event.preventDefault();
        }, { passive: false });
      }

      // 点击遮罩关闭弹窗
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeTop();
        }
      });

      // 获取添加目标
      const haRoot = document.querySelector('home-assistant');
      let appendTarget = document.body;

      if (haRoot?.shadowRoot) {
        const haMain = haRoot.shadowRoot.querySelector('home-assistant-main');
        if (haMain?.shadowRoot) {
          const lovelace = haMain.shadowRoot.querySelector('ha-panel-lovelace');
          if (lovelace?.shadowRoot) {
            const huiRoot = lovelace.shadowRoot.querySelector('hui-root');
            if (huiRoot) {
              appendTarget = huiRoot.shadowRoot || huiRoot;
            }
          }
        }
      }

      appendTarget.appendChild(overlay);

      // 创建弹窗容器
      const popup = document.createElement('div');
      popup.className = 'popup-card-popup';

      // 根据是否有标题/头部调整样式
      if (hideBorder) {
        // 隐藏头部模式
        popup.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: ${zIndex};
          background: transparent;
          color: var(--primary-text-color);
          border-radius: 0;
          padding: 0;
          width: min(90vw, var(--ha-dialog-width-md, 580px));
          max-width: var(--ha-dialog-max-width, 95vw);
          max-height: var(--ha-dialog-max-height, 90vh);
          overflow: hidden;
          box-shadow: none;
          border: none !important;
          outline: none;
          box-sizing: border-box;
        `;
      } else {
        // 正常模式 - 响应式设计
        const padding = isMobile ? '12px' : '16px';
        const headerPadding = hideTitleBar ? (mobileSheet ? '32px' : padding) : (mobileSheet ? '56px' : isMobile ? '44px' : '60px');
        if (hideTitleBar) popup.classList.add('popup-card-no-title-bar');

        popup.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: ${zIndex};
          background: var(--ha-dialog-surface-background, var(--card-background-color, var(--primary-background-color)));
          color: var(--primary-text-color);
          border-radius: var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 16px));
          padding: ${headerPadding} ${padding} ${padding} ${padding};
          width: min(90vw, var(--ha-dialog-width-md, 580px));
          max-width: var(--ha-dialog-max-width, 95vw);
          max-height: var(--ha-dialog-max-height, 90vh);
          overflow: hidden;
          box-shadow: var(--dialog-box-shadow, var(--ha-box-shadow-l, var(--ha-card-box-shadow, 0 16px 40px rgba(0, 0, 0, 0.24))));
          box-sizing: border-box;
        `;

        // 添加标题
        if (title && !hideTitleBar) {
          const titleEl = document.createElement('div');
          titleEl.className = 'popup-card-title';
          titleEl.textContent = title;
          titleEl.style.cssText = `
            position: absolute;
            top: ${mobileSheet ? '24px' : isMobile ? '8px' : '10px'};
            height: ${isMobile ? '28px' : '32px'};
            line-height: ${isMobile ? '28px' : '32px'};
            left: 50%;
            transform: translateX(-50%);
            font-size: calc(var(--ha-dialog-header-title-font-size, var(--ha-card-header-font-size, var(--ha-font-size-xl, 20px))) - 2px);
            font-weight: var(--ha-dialog-header-title-font-weight, var(--ha-font-weight-medium, 600));
            color: var(--ha-dialog-header-title-color, var(--primary-text-color));
            font-family: var(--ha-font-family-heading, inherit);
            white-space: nowrap;
            padding: 0 ${jumpEnabled ? '52px' : '44px'};
            box-sizing: border-box;
          `;
          popup.appendChild(titleEl);
        }

        // 标题栏隐藏时同时隐藏所有标题栏操作按钮。
        if (!hideTitleBar) {
          const closeBtn = document.createElement('button');
          closeBtn.type = 'button';
          closeBtn.setAttribute('aria-label', '关闭弹窗');
          closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              ${jumpEnabled
                ? '<path d="M15 5l-7 7 7 7" />'
                : '<path d="M6 6l12 12M18 6L6 18" />'}
            </svg>
          `;
          closeBtn.style.cssText = `
            position: absolute;
            top: ${mobileSheet ? '22px' : isMobile ? '8px' : '10px'};
            ${jumpEnabled ? `left: ${isMobile ? '8px' : '10px'};` : `right: ${isMobile ? '8px' : '10px'};`}
            width: ${isMobile ? '28px' : '32px'};
            height: ${isMobile ? '28px' : '32px'};
            padding: 0;
            border: none;
            background: var(--ha-color-fill-neutral-quiet-hover, rgba(127, 127, 127, 0.12));
            color: var(--primary-text-color);
            border-radius: 50%;
            cursor: pointer;
            display: grid;
            place-items: center;
            z-index: 10;
          `;
          const closeIcon = closeBtn.querySelector('svg');
          closeIcon.style.cssText = `display: block; width: ${isMobile ? '14px' : '16px'}; height: ${isMobile ? '14px' : '16px'};`;
          const closePath = closeIcon.querySelector('path');
          closePath.setAttribute('fill', 'none');
          closePath.setAttribute('stroke', 'currentColor');
          closePath.setAttribute('stroke-width', jumpEnabled ? '2.5' : '2');
          closePath.setAttribute('stroke-linecap', 'round');
          closePath.setAttribute('stroke-linejoin', 'round');
          closeBtn.onclick = () => this.closeTop();
          popup.appendChild(closeBtn);

          if (jumpEnabled) {
            const jumpBtn = document.createElement('a');
            jumpBtn.setAttribute('aria-label', '跳转');
            jumpBtn.title = '跳转';
            jumpBtn.innerHTML = `
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="5" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="12" cy="19" r="1.7" />
              </svg>
            `;
            if (jumpPath) {
              jumpBtn.href = jumpPath.startsWith('/') ? jumpPath : `/${jumpPath}`;
            } else {
              jumpBtn.setAttribute('aria-disabled', 'true');
              jumpBtn.tabIndex = -1;
              jumpBtn.style.opacity = '0.45';
            }
            jumpBtn.style.cssText += `
              position: absolute;
              top: ${mobileSheet ? '22px' : isMobile ? '8px' : '10px'};
              right: ${isMobile ? '8px' : '10px'};
              width: ${isMobile ? '28px' : '32px'};
              height: ${isMobile ? '28px' : '32px'};
              padding: 0;
              border: none;
              background: var(--ha-color-fill-neutral-quiet-hover, rgba(127, 127, 127, 0.12));
              color: var(--primary-text-color);
              border-radius: 50%;
              display: grid;
              place-items: center;
              text-decoration: none;
              z-index: 10;
            `;
            const jumpIcon = jumpBtn.querySelector('svg');
            jumpIcon.style.cssText = `display: block; width: ${isMobile ? '14px' : '16px'}; height: ${isMobile ? '14px' : '16px'}; fill: currentColor;`;
            jumpBtn.addEventListener('click', (event) => {
              if (!jumpPath) {
                event.preventDefault();
                return;
              }
              const state = history.state && typeof history.state === 'object' ? { ...history.state } : {};
              delete state.__popupCardHistory;
              history.replaceState(state, '', window.location.href);
              while (this._popupStack.length) this.closeTop(true);
            });
            popup.appendChild(jumpBtn);
          }
        }
      }
      popup._popupCenterTransform = 'translate(-50%, -50%)';
      popup._popupSheet = mobileSheet;
      popup.style.setProperty('transform-origin', 'center center', 'important');

      if (mobileSheet) {
        // 底部面板沿用 HA 对话框表面色和圆角，只在移动端改变布局。
        popup.style.setProperty('top', 'auto', 'important');
        popup.style.setProperty('left', '0', 'important');
        popup.style.setProperty('right', '0', 'important');
        popup.style.setProperty('bottom', '0', 'important');
        popup.style.setProperty('width', '100%', 'important');
        popup.style.setProperty('max-width', 'none', 'important');
        popup.style.setProperty('max-height', 'min(92dvh, 860px)', 'important');
        popup.style.setProperty('transform', 'translateY(0)');
        popup.style.setProperty('transform-origin', 'center bottom', 'important');
        if (!hideBorder) {
          popup.style.setProperty('background-color', 'var(--ha-dialog-surface-background, var(--card-background-color, var(--primary-background-color)))', 'important');
        }
        popup.style.setProperty('border-radius', hideBorder ? '0' : 'var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 16px)) var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 16px)) 0 0', 'important');
        popup.style.setProperty('padding-bottom', 'calc(12px + env(safe-area-inset-bottom, 0px))', 'important');
        popup.style.setProperty('transition', 'transform 220ms cubic-bezier(0.2, 0, 0, 1), top 220ms cubic-bezier(0.2, 0, 0, 1), height 220ms cubic-bezier(0.2, 0, 0, 1), max-height 220ms cubic-bezier(0.2, 0, 0, 1)', 'important');
        popup.style.setProperty('touch-action', 'auto', 'important');

        const handle = document.createElement('div');
        handle.className = 'popup-card-sheet-handle';
        handle.setAttribute('role', 'button');
        handle.setAttribute('tabindex', '0');
        handle.setAttribute('aria-label', '拖动展开或收起弹窗');
        handle.title = '拖动展开或收起弹窗';
        handle.style.cssText = `
          position: absolute;
          top: 8px;
          left: 50%;
          width: 36px;
          height: 5px;
          transform: translateX(-50%);
          border-radius: 999px;
          background: var(--secondary-text-color, var(--primary-text-color));
          opacity: 0.42;
          cursor: grab;
          touch-action: none;
          pointer-events: auto;
          z-index: 20;
        `;
        popup.appendChild(handle);
        popup._popupSheetExpanded = false;

        const sheetViewportHeight = () => window.visualViewport?.height || window.innerHeight;
        const sheetChromeHeight = () => {
          const styles = getComputedStyle(popup);
          return (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
        };
        const floatingPopupMaxHeight = (viewportHeight) => {
          const configured = getComputedStyle(popup).getPropertyValue('--ha-dialog-max-height').trim();
          const match = configured.match(/^([\d.]+)\s*(dvh|vh|px)$/);
          if (match) {
            const amount = Number.parseFloat(match[1]);
            if (match[2] === 'px') return amount;
            return viewportHeight * amount / 100;
          }
          return viewportHeight * 0.9;
        };
        const floatingPopupTop = (naturalHeight, viewportHeight) => {
          const floatingMax = floatingPopupMaxHeight(viewportHeight);
          // 长内容直接展开到弹窗的高度上限
          return Math.max(0, (viewportHeight - Math.min(naturalHeight, floatingMax)) / 2);
        };
        popup._floatingPopupTop = floatingPopupTop;
        const setSheetGeometry = (top, height) => {
          popup.style.setProperty('top', `${top}px`, 'important');
          popup.style.setProperty('bottom', 'auto', 'important');
          popup.style.setProperty('height', `${height}px`, 'important');
          popup.style.setProperty('max-height', `${height}px`, 'important');
          popup._sheetContent?.style.setProperty('max-height', `${Math.max(0, height - sheetChromeHeight())}px`, 'important');
        };
        popup._setSheetGeometry = setSheetGeometry;
        popup._refreshSheetHeight = () => {
          if (!popup.isConnected || !popup._sheetContent) return;
          const viewportHeight = sheetViewportHeight();
          const maximumHeight = Math.min(viewportHeight * 0.92, 860);
          const chromeHeight = sheetChromeHeight();
          const contentHeight = Math.max(
            popup._sheetContent.scrollHeight,
            popup._sheetContent.getBoundingClientRect().height
          );
          const naturalHeight = contentHeight + chromeHeight;
          const minimumHeight = Math.min(maximumHeight, chromeHeight + 72);
          const nextHeight = Math.min(maximumHeight, Math.max(minimumHeight, naturalHeight));
          const nextExpandedTop = floatingPopupTop(naturalHeight, viewportHeight);
          const expandedContentLimit = Math.max(0, viewportHeight - nextExpandedTop - chromeHeight);
          const overflowsAtMaximum = contentHeight > expandedContentLimit + 1;
          const expandedTopChanged = Math.abs(nextExpandedTop - popup._sheetExpandedTop) > 1;
          const nextTop = Math.max(nextExpandedTop, viewportHeight - nextHeight);
          const changed = Math.abs(nextHeight - popup._sheetCollapsedHeight) > 1 ||
            Math.abs(nextTop - popup._sheetCollapsedTop) > 1;
          popup._sheetOverflowsAtMaximum = overflowsAtMaximum;
          popup._sheetExpandedTop = nextExpandedTop;
          popup._sheetCollapsedHeight = viewportHeight - nextTop;
          popup._sheetCollapsedTop = nextTop;
          if (changed && !popup._popupSheetExpanded && !popup._sheetDragging) {
            popup._setSheetGeometry(popup._sheetCollapsedTop, popup._sheetCollapsedHeight);
          }
          if (overflowsAtMaximum && !popup._popupSheetExpanded && !popup._sheetUserInteracted && !popup._sheetDragging) {
            popup._sheetForcedExpanded = true;
            setExpanded(true);
            return;
          }
          if (expandedTopChanged && popup._popupSheetExpanded && !popup._sheetDragging) {
            popup._setSheetGeometry(nextExpandedTop, viewportHeight - nextExpandedTop);
          }
        };
        const setExpanded = (expanded, userInitiated = false) => {
          if (userInitiated) popup._sheetUserInteracted = true;
          if (expanded && popup._sheetOverflowsAtMaximum) popup._sheetForcedExpanded = true;
          if (!expanded && userInitiated) popup._sheetForcedExpanded = false;
          popup._popupSheetExpanded = expanded;
          const top = expanded ? popup._sheetExpandedTop : popup._sheetCollapsedTop;
          const height = expanded
            ? sheetViewportHeight() - top
            : popup._sheetCollapsedHeight;
          setSheetGeometry(top, height);
          popup.style.setProperty('border-radius', hideBorder ? '0' : 'var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 16px)) var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 16px)) 0 0', 'important');
          popup.style.setProperty('transform', 'translateY(0)');
        };
        popup._sheetUserInteracted = false;
        let sheetWasDragged = false;
        handle.addEventListener('click', (event) => {
          if (sheetWasDragged) {
            sheetWasDragged = false;
            event.preventDefault();
            return;
          }
          setExpanded(!popup._popupSheetExpanded, true);
        });
        handle.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded(!popup._popupSheetExpanded, true);
          }
        });

        // 面板的卡片内容和操作按钮保留自己的触摸/点击；其余面板区域统一作为拖拽区。
        let dragStartY = null;
        let dragWasExpanded = false;
        let dragSource = null;
        let dragBaseTop = 0;
        const isExcludedDragTarget = (target) => {
          if (!(target instanceof Element)) return true;
          if (target.closest('.popup-card-content')) return true;
          if (target.closest('button, a, input, select, textarea, [role="button"], ha-button, ha-icon-button')) {
            return !handle.contains(target);
          }
          return false;
        };
        const startSheetDrag = (clientY, source) => {
          dragStartY = clientY;
          dragWasExpanded = popup._popupSheetExpanded;
          dragSource = source;
          dragBaseTop = popup.getBoundingClientRect().top;
          popup._sheetDragging = true;
          sheetWasDragged = false;
          popup.style.setProperty('transition', 'none', 'important');
        };
        const moveSheetDrag = (clientY, event) => {
          if (dragStartY === null) return;
          const delta = clientY - dragStartY;
          if (Math.abs(delta) > 6) sheetWasDragged = true;
          const viewportHeight = sheetViewportHeight();
          if (delta < 0 || dragWasExpanded && delta > 0 && !popup._sheetForcedExpanded) {
            const nextTop = Math.max(
              popup._sheetExpandedTop,
              Math.min(popup._sheetCollapsedTop, dragBaseTop + delta)
            );
            setSheetGeometry(nextTop, viewportHeight - nextTop);
            const excessDown = dragWasExpanded ? Math.max(0, dragBaseTop + delta - popup._sheetCollapsedTop) : 0;
            popup.style.setProperty('transform', `translateY(${excessDown}px)`, 'important');
          } else {
            popup.style.setProperty('transform', `translateY(${delta}px)`, 'important');
          }
          event.preventDefault();
        };
        const finishSheetDrag = (clientY) => {
          if (dragStartY === null) return;
          const delta = clientY - dragStartY;
          const wasExpanded = dragWasExpanded;
          dragStartY = null;
          dragSource = null;
          popup._sheetDragging = false;
          if (!sheetWasDragged) {
            popup.style.setProperty('transition', 'transform 220ms cubic-bezier(0.2, 0, 0, 1), top 220ms cubic-bezier(0.2, 0, 0, 1), height 220ms cubic-bezier(0.2, 0, 0, 1), max-height 220ms cubic-bezier(0.2, 0, 0, 1)', 'important');
            setExpanded(wasExpanded);
            return;
          }
          if (delta > 130) {
            // 保留拖动后的面板几何位置，再从剩余的下移距离接续关闭动画。
            const remainingOffset = wasExpanded
              ? popup._sheetForcedExpanded
                ? delta
                : Math.max(0, dragBaseTop + delta - popup._sheetCollapsedTop)
              : delta;
            popup.style.removeProperty('transition');
            popup.style.removeProperty('transform');
            if (remainingOffset) popup.style.setProperty('transform', `translateY(${remainingOffset}px)`);
            popup._popupSheetDragOffset = remainingOffset;
            this.closeTop();
            return;
          }
          popup.style.setProperty('transition', 'transform 220ms cubic-bezier(0.2, 0, 0, 1), top 220ms cubic-bezier(0.2, 0, 0, 1), height 220ms cubic-bezier(0.2, 0, 0, 1), max-height 220ms cubic-bezier(0.2, 0, 0, 1)', 'important');
          if (wasExpanded && popup._sheetForcedExpanded && delta > 0) {
            setExpanded(true, true);
            return;
          }
          const travelDistance = wasExpanded
            ? Math.max(0, popup._sheetCollapsedTop - dragBaseTop)
            : Math.max(0, dragBaseTop - popup._sheetExpandedTop);
          const snapThreshold = Math.min(55, Math.max(12, travelDistance));
          setExpanded(wasExpanded ? delta < snapThreshold : delta <= -snapThreshold, true);
        };

        popup.addEventListener('pointerdown', (event) => {
          if (event.pointerType === 'touch' || event.button !== 0 || isExcludedDragTarget(event.target)) return;
          startSheetDrag(event.clientY, 'pointer');
          popup.setPointerCapture?.(event.pointerId);
        });
        popup.addEventListener('pointermove', (event) => {
          if (dragSource !== 'pointer') return;
          moveSheetDrag(event.clientY, event);
        });
        popup.addEventListener('pointerup', (event) => {
          if (dragSource === 'pointer') finishSheetDrag(event.clientY);
        });
        popup.addEventListener('pointercancel', (event) => {
          if (dragSource === 'pointer') finishSheetDrag(event.clientY);
        });
        popup.addEventListener('touchstart', (event) => {
          if (dragStartY !== null || isExcludedDragTarget(event.target)) return;
          startSheetDrag(event.touches[0].clientY, 'touch');
        }, { passive: true });
        popup.addEventListener('touchmove', (event) => {
          if (dragSource !== 'touch') return;
          moveSheetDrag(event.touches[0].clientY, event);
        }, { passive: false });
        popup.addEventListener('touchend', (event) => {
          if (dragSource === 'touch') finishSheetDrag(event.changedTouches[0].clientY);
        });
        popup.addEventListener('touchcancel', (event) => {
          if (dragSource === 'touch') finishSheetDrag(event.changedTouches[0].clientY);
        });
      }

      // 创建卡片内容容器（可滚动）
      const contentContainer = document.createElement('div');
      contentContainer.className = 'popup-card-content';
      const paddingValue = isMobile ? '12px' : '16px';
      contentContainer.style.cssText = `
        overflow-y: auto;
        overflow-x: visible;
        max-height: calc(var(--ha-dialog-max-height, 90vh) - ${hideBorder ? '30px' : hideTitleBar ? '50px' : isMobile ? '60px' : '70px'});
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        padding: ${hideTitleBar && !hideBorder ? paddingValue : '0'} ${paddingValue} ${paddingValue} ${paddingValue};
        box-sizing: border-box;
        ${hideBorder || hideTitleBar ? '' : 'padding-top: 8px;'}
      `;
      if (mobileSheet) {
        const headerSpace = hideTitleBar || hideBorder ? '32px' : '56px';
        popup._sheetContent = contentContainer;
        contentContainer.style.setProperty('max-height', `calc(min(92dvh, 860px) - ${headerSpace} - env(safe-area-inset-bottom, 0px))`, 'important');
        contentContainer.style.setProperty('padding', '8px 12px 12px', 'important');
        contentContainer.style.setProperty('overscroll-behavior', 'contain', 'important');
        contentContainer.style.setProperty('touch-action', 'pan-y', 'important');
        popup.addEventListener('touchmove', (event) => {
          if (!contentContainer.contains(event.target) &&
              !event.target.closest?.('button, a, input, select, textarea, [role="button"], ha-button, ha-icon-button')) {
            event.preventDefault();
          }
        }, { passive: false });
      }

      let cardElement = null;
      try {
        // 尝试从缓存获取卡片元素
        const cachedElement = this._getCachedCard(cardConfig);
        if (cachedElement) {
          cardElement = cachedElement;
          const haRoot = document.querySelector('home-assistant');
          this.hass = haRoot?.hass || haRoot?.shadowRoot?.querySelector('home-assistant-main')?.hass;
          if (this.hass) {
            cardElement.hass = this.hass;
          }
          contentContainer.appendChild(cardElement);
          popupCardLog('[popup_card] 命中卡片缓存，跳过创建');
        } else {
          // 使用 Home Assistant 的卡片创建机制
          const helpers = await window.loadCardHelpers?.();
          if (helpers) {
            cardElement = await helpers.createCardElement(cardConfig);

            // 立即设置 hass
            const haRoot = document.querySelector('home-assistant');
            this.hass = haRoot?.hass || haRoot?.shadowRoot?.querySelector('home-assistant-main')?.hass;
            if (this.hass) {
              cardElement.hass = this.hass;
            }

            contentContainer.appendChild(cardElement);
          } else {
            // 备用方案：直接显示配置信息
            contentContainer.innerHTML = `
              <div style="padding: 20px;">
                <p><strong>卡片类型：${cardConfig.type}</strong></p>
                <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; overflow: auto;">${JSON.stringify(cardConfig, null, 2)}</pre>
              </div>
            `;
          }
        }
      } catch (err) {
        console.error('[popup_card] 创建卡片失败:', err);
        contentContainer.innerHTML = `<div style="color: red; padding: 20px;">卡片加载失败：${err.message}</div>`;
      }

      popup.appendChild(contentContainer);
      appendTarget.appendChild(popup);
      if (mobileSheet) {
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const maximumHeight = Math.min(viewportHeight * 0.92, 860);
        const popupStyles = getComputedStyle(popup);
        const popupChrome = (Number.parseFloat(popupStyles.paddingTop) || 0) + (Number.parseFloat(popupStyles.paddingBottom) || 0);
        const contentHeight = Math.max(contentContainer.scrollHeight, contentContainer.getBoundingClientRect().height);
        const measuredHeight = popup.getBoundingClientRect().height;
        const minimumHeight = Math.min(maximumHeight, popupChrome + 72);
        const naturalSheetHeight = contentHeight + popupChrome;
        popup._sheetCollapsedHeight = Math.min(maximumHeight, Math.max(minimumHeight, measuredHeight, naturalSheetHeight));
        popup._sheetExpandedTop = popup._floatingPopupTop(naturalSheetHeight, viewportHeight);
        popup._sheetCollapsedTop = Math.max(popup._sheetExpandedTop, viewportHeight - popup._sheetCollapsedHeight);
        popup._sheetCollapsedHeight = viewportHeight - popup._sheetCollapsedTop;
        popup._setSheetGeometry(popup._sheetCollapsedTop, popup._sheetCollapsedHeight);
        popup._refreshSheetHeight();
        if (typeof ResizeObserver === 'function') {
          popup._sheetResizeObserver = new ResizeObserver(() => {
            if (popup._sheetResizeFrame) return;
            popup._sheetResizeFrame = requestAnimationFrame(() => {
              popup._sheetResizeFrame = 0;
              popup._refreshSheetHeight();
            });
          });
          popup._sheetResizeObserver.observe(contentContainer);
          if (cardElement) popup._sheetResizeObserver.observe(cardElement);
        }
      }

      // 模仿 HA 对话框动画，同时尊重系统的减少动态效果设置。
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotion && typeof popup.animate === 'function') {
        const duration = this._motionDuration(popup, '--ha-dialog-show-duration', 200);
        if (duration > 0) {
        overlay.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both'
        });
        popup.animate(
          mobileSheet
            ? [{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, transform: 'translateY(0)' }]
            : [
                { opacity: 0, transform: `${popup._popupCenterTransform} scale(0.96)` },
                { opacity: 1, transform: `${popup._popupCenterTransform} scale(1)` }
              ],
          { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' }
        );
        }
      }

      // 将弹窗添加到栈中（保存卡片引用 + 追踪实体 + 缓存配置）
      const trackedEntities = this._extractEntities(cardConfig);
      this._popupStack.push({ popup, overlay, appendTarget, cardElement, _trackedEntities: trackedEntities, _cardConfig: cardConfig });
      this._pushPopupHistory();

      // 启动 HA 状态订阅（若尚未订阅）
      if (!this._hassUnsubscribe) {
        this._startHassWatcher();
      }

      // 按 Escape 键关闭最上层弹窗
      if (!this._escHandler) {
        this._escHandler = (e) => {
          if (e.key === 'Escape') this.closeTop();
        };
        window.addEventListener('keydown', this._escHandler);
      }
      if (!this._popstateHandler) {
        this._popstateHandler = (event) => {
          const marker = event.state?.__popupCardHistory;
          if (this._popupStack.length === 0) {
            if (marker?.owner === this._historyOwner) event.stopImmediatePropagation?.();
            return;
          }
          if (marker?.owner === this._historyOwner && marker.depth === this._popupStack.length) {
            event.stopImmediatePropagation?.();
            return;
          }
          event.stopImmediatePropagation?.();
          this.closeTop(true);
        };
        window.addEventListener('popstate', this._popstateHandler, true);
      }

      popupCardLog('[popup_card] 弹窗已显示，当前栈深度:', this._popupStack.length);
    },

    _pushPopupHistory() {
      try {
        const state = history.state && typeof history.state === 'object' ? { ...history.state } : {};
        state.__popupCardHistory = { owner: this._historyOwner, depth: this._popupStack.length };
        history.pushState(state, '', window.location.href);
      } catch (error) {
        console.warn('[popup_card] 无法添加返回键历史记录:', error);
      }
    },

    // 关闭最上层的弹窗
    closeTop(fromHistory = false) {
      if (this._popupStack.length === 0) return;

      const depth = this._popupStack.length;
      const popupInfo = this._popupStack.pop();
      this._dismissPopup(popupInfo);
      const marker = history.state?.__popupCardHistory;
      if (!fromHistory && marker?.owner === this._historyOwner && marker.depth === depth) history.back();

      // 所有弹窗关闭后取消 HA 状态订阅
      if (this._popupStack.length === 0 && this._hassUnsubscribe) {
        this._hassUnsubscribe();
        this._hassUnsubscribe = null;
        popupCardLog('[popup_card] 已取消 hass 状态订阅');
      }

      popupCardLog('[popup_card] 弹窗已关闭，剩余栈深度:', this._popupStack.length, '缓存:', this._cardCache.size);
    },

    // 关闭所有弹窗
    close() {
      // 从后往前关闭所有弹窗
      while (this._popupStack.length > 0) {
        const popupInfo = this._popupStack.pop();
        this._dismissPopup(popupInfo);
      }
      const marker = history.state?.__popupCardHistory;
      if (marker?.owner === this._historyOwner && marker.depth > 0) history.go(-marker.depth);

      // 移除 Escape 键监听器
      if (this._escHandler) {
        window.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
      }

      // 取消 HA 状态订阅
      if (this._hassUnsubscribe) {
        this._hassUnsubscribe();
        this._hassUnsubscribe = null;
        popupCardLog('[popup_card] 已取消 hass 状态订阅');
      }

      // 清理所有重试定时器
      this._retryTimers.forEach(timer => clearTimeout(timer));
      this._retryTimers = [];

      // 取消待处理的逐帧更新
      this._updatePending = false;
      this._staleUpdate = false;

      popupCardLog('[popup_card] 所有弹窗已关闭，缓存:', this._cardCache.size);
    },

    _motionDuration(element, property, fallback) {
      const value = getComputedStyle(element).getPropertyValue(property).trim();
      const amount = Number.parseFloat(value);
      if (!Number.isFinite(amount)) return fallback;
      if (value.endsWith('ms')) return amount;
      if (value.endsWith('s')) return amount * 1000;
      return fallback;
    },

    _dismissPopup(popupInfo) {
      const removePopup = () => {
        if (popupInfo._removed) return;
        popupInfo._removed = true;
        popupInfo.popup._sheetResizeObserver?.disconnect();
        if (popupInfo.popup._sheetResizeFrame) cancelAnimationFrame(popupInfo.popup._sheetResizeFrame);
        if (popupInfo.cardElement && popupInfo._cardConfig) {
          popupInfo.cardElement.remove();
          this._cacheCard(popupInfo._cardConfig, popupInfo.cardElement);
        }
        popupInfo.overlay.remove();
        popupInfo.popup.remove();
      };

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion || typeof popupInfo.popup.animate !== 'function') {
        removePopup();
        return;
      }

      const duration = this._motionDuration(popupInfo.popup, '--ha-dialog-hide-duration', 160);
      if (duration <= 0) {
        removePopup();
        return;
      }
      const sheetOffset = popupInfo.popup._popupSheetDragOffset || 0;
      const animations = [
        popupInfo.popup.animate(
          [
            popupInfo.popup._popupSheet
              ? { opacity: 1, transform: `translateY(${sheetOffset}px)` }
              : { opacity: 1, transform: `${popupInfo.popup._popupCenterTransform || 'translate(-50%, -50%)'} scale(1)` },
            popupInfo.popup._popupSheet
              ? { opacity: 0, transform: 'translateY(100%)' }
              : { opacity: 0, transform: `${popupInfo.popup._popupCenterTransform || 'translate(-50%, -50%)'} scale(0.98)` }
          ],
          { duration, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' }
        ),
        popupInfo.overlay.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' }
        )
      ];
      Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
        .then(removePopup);
    }
  };

  // ========================================
  // 初始化
  // ========================================
  const init = () => {
    popupCardLog('[popup_card] 开始初始化');
    window.GlobalPopupController.init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

  // ========================================
  // 监听页面可见性变化
  // ========================================
  document.addEventListener('visibilitychange', () => {
    const ctrl = window.GlobalPopupController;

    if (document.visibilityState === 'visible') {
      ctrl._isVisible = true;
      popupCardLog('[popup_card] 页面可见，恢复更新');

      // 页面不可见期间有状态变化，恢复后统一刷新一次
      if (ctrl._staleUpdate && ctrl._popupStack.length > 0) {
        ctrl._staleUpdate = false;
        const haRoot = document.querySelector('home-assistant');
        const newHass = haRoot?.hass || haRoot?.shadowRoot?.querySelector('home-assistant-main')?.hass;
        if (newHass && newHass !== ctrl.hass) {
          ctrl.hass = newHass;
          ctrl._updateAllCards();
        }
      }

    } else {
      ctrl._isVisible = false;
      popupCardLog('[popup_card] 页面不可见，暂停更新');

    }
  });

  // ========================================
  // 添加样式
  // ========================================
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    /* 基础样式 */
    .popup-card-popup {
      pointer-events: auto !important;
      box-sizing: border-box;
      transform-origin: center center !important;
    }

    .popup-card-popup * {
      pointer-events: auto !important;
      box-sizing: border-box;
    }

    .popup-card-content {
      pointer-events: auto !important;
      overscroll-behavior: contain;
    }

    .popup-card-overlay {
      pointer-events: auto !important;
    }

    /* 滚动条样式 */
    .popup-card-content::-webkit-scrollbar {
      width: 6px;
    }
    .popup-card-content::-webkit-scrollbar-track {
      background: rgba(0,0,0,0.1);
      border-radius: 3px;
    }
    .popup-card-content::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.3);
      border-radius: 3px;
    }
    .popup-card-content::-webkit-scrollbar-thumb:hover {
      background: rgba(0,0,0,0.5);
    }

    /* 响应式设计 - 手机端 */
    @media (max-width: 767px) {
      .popup-card-popup {
        width: 95vw !important;
        max-width: 95vw !important;
        left: 2.5vw !important;
        top: 50%;
      }

      .popup-card-title {
        top: 8px !important;
        width: calc(100% - 60px) !important;
      }

      .popup-card-popup:not(.popup-card-no-title-bar) .popup-card-content {
        padding: 8px !important;
        max-height: calc(90vh - 60px) !important;
      }

    }

    /* 平板端 */
    @media (min-width: 768px) and (max-width: 1024px) {
      .popup-card-popup {
        width: 65vw !important;
        max-width: 500px !important;
      }
    }

    /* 桌面端 */
    @media (min-width: 1025px) {
      .popup-card-popup {
        width: auto !important;
        max-width: 550px !important;
      }
    }

    /* 超小屏幕 */
    @media (max-width: 375px) {
      .popup-card-popup {
        width: 98vw !important;
        left: 1vw !important;
        border-radius: var(--ha-dialog-border-radius, 12px) !important;
      }
    }
  `;
  document.head.appendChild(styleSheet);

  // ========================================
  // 挂载到 window
  // ========================================
  if (typeof window !== 'undefined') {
    window.PopupCardClass = PopupCard;
    popupCardLog('[popup_card] ✓ 所有对象已挂载到 window');
  }

  popupCardLog('%c popup-card 已加载 ✓', 'background: #3498db; color: white; padding: 4px 8px; border-radius: 4px;');

} catch (error) {
  console.error('[popup_card] ✗ 加载失败:', error);
  console.error('[popup_card] 错误堆栈:', error.stack);
}
