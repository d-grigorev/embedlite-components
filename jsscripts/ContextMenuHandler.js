/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const kXLinkNamespace = "http://www.w3.org/1999/xlink";

Logger.debug("JSScript: ContextMenuHandler.js loaded");

var ContextMenuHandler = {
  _types: [],
  _previousState: null,

  init: function ch_init() {
    // Events we catch from content during the bubbling phase
    addEventListener("contextmenu", this, false);
    addEventListener("pagehide", this, false);
    this.popupNode = null;
  },

  handleEvent: function ch_handleEvent(aEvent) {
    switch (aEvent.type) {
      case "contextmenu":
        this._onContentContextMenu(aEvent);
        break;
      case "pagehide":
        this.reset();
        break;
    }
  },

  /******************************************************
   * Event handlers
   */

  reset: function ch_reset() {
    this.popupNode = null;
    this._target = null;
  },

  // content contextmenu handler
  _onContentContextMenu: function _onContentContextMenu(aEvent) {
    if (aEvent.defaultPrevented)
      return;

    // Don't let these bubble up to input.js
    aEvent.stopPropagation();
    aEvent.preventDefault();

    this._processPopupNode(aEvent.originalTarget, aEvent.clientX,
                           aEvent.clientY, aEvent.mozInputSource);
  },

  /******************************************************
   * Utility routines
   */

  /*
   * _processPopupNode - Generate and send a Content:ContextMenu message
   * to browser detailing the underlying content types at this.popupNode.
   * Note the event we receive targets the sub frame (if there is one) of
   * the page.
   */
  _processPopupNode: function _processPopupNode(aPopupNode, aX, aY, aInputSrc) {
    if (!aPopupNode)
      return;

    let { targetWindow: targetWindow,
          offsetX: offsetX,
          offsetY: offsetY } =
      Util.translateToTopLevelWindow(aPopupNode);

    let popupNode = this.popupNode = aPopupNode;
    let imageUrl = "";

    let state = {
      types: [],
      label: "",
      linkURL: "",
      linkTitle: "",
      linkProtocol: null,
      mediaURL: "",
      contentType: "",
      contentDisposition: "",
      string: "",
    };

    // Do checks for nodes that never have children.
    if (popupNode.nodeType == content.Node.ELEMENT_NODE) {
      // See if the user clicked on an image.
      if (popupNode instanceof Ci.nsIImageLoadingContent && popupNode.currentURI) {
        state.types.push("image");
        state.label = state.mediaURL = popupNode.currentURI.spec;
        imageUrl = state.mediaURL;
        this._target = popupNode;

        // Retrieve the type of image from the cache since the url can fail to
        // provide valuable informations
        try {
          let tools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);
          let imageCache = tools.getImgCacheForDocument(content.document);
          let props = imageCache.findEntryProperties(popupNode.currentURI);

          if (props) {
            if (props.has("type"))
              state.contentType = String(props.get("type", Ci.nsISupportsCString));

            if (props.has("content-disposition"))
              state.contentDisposition = String(props.get("content-disposition",
                                                          Ci.nsISupportsCString));
          }
        } catch (ex) {
          Logger.warn(ex.message);
          // Failure to get type and content-disposition off the image is non-fatal
        }
      }
    }

    let elem = popupNode;
    let isText = false;


    while (elem) {
      if (elem.nodeType == content.Node.ELEMENT_NODE) {
        // is the target a link or a descendant of a link?
        if (Util.isLink(elem)) {
          // If this is an image that links to itself, don't include both link and
          // image otpions.
          if (imageUrl == this._getLinkURL(elem)) {
            elem = elem.parentNode;
            continue;
          }

          state.types.push("link");
          state.label = state.linkURL = this._getLinkURL(elem);
          state.linkTitle = popupNode.textContent || popupNode.title;
          state.linkProtocol = this._getProtocol(this._getURI(state.linkURL));
          // mark as text so we can pickup on selection below
          isText = true;
          break;
        } else if (Util.isTextInput(elem)) {
          let selectionStart = elem.selectionStart;
          let selectionEnd = elem.selectionEnd;

          state.types.push("input-text");
          this._target = elem;

          // Don't include "copy" for password fields.
          if (!(elem instanceof content.HTMLInputElement) || elem.mozIsTextField(true)) {
            // If there is a selection add cut and copy
            if (selectionStart != selectionEnd) {
              state.types.push("cut");
              state.types.push("copy");
              state.string = elem.value.slice(selectionStart, selectionEnd);
            } else if (elem.value && elem.textLength) {
              // There is text and it is not selected so add selectable items
              state.types.push("selectable");
              state.string = elem.value;
            }
          }

          if (!elem.textLength) {
            state.types.push("input-empty");
          }

          let flavors = ["text/unicode"];
          let cb = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
          let hasData = cb.hasDataMatchingFlavors(flavors,
                                                  flavors.length,
                                                  Ci.nsIClipboard.kGlobalClipboard);
          if (hasData && !elem.readOnly) {
            state.types.push("paste");
          }
          break;
        } else if (Util.isMedia(elem)) {
          state.label = state.mediaURL = (elem.currentSrc || elem.src);
          state.types.push((elem.paused || elem.ended) ?
            "media-paused" : "media-playing");
          if (elem instanceof targetWindow.HTMLVideoElement) {
            state.types.push("video");
          }
          isText = false;
          break;
        } else if (Util.isText(elem)) {
          isText = true;
        }
      }

      elem = elem.parentNode;
    }

    // Over arching text tests
    if (isText) {
      // If this is text and has a selection, we want to bring
      // up the copy option on the context menu.
      let selection = targetWindow.getSelection();
      if (selection && selection.toString().length > 0) {
        state.string = targetWindow.getSelection().toString();
        state.types.push("copy");
        state.types.push("selected-text");
      } else {
        // Add general content text if this isn't anything specific
        if (state.types.indexOf("image") == -1 &&
            state.types.indexOf("media") == -1 &&
            state.types.indexOf("video") == -1 &&
            state.types.indexOf("link") == -1 &&
            state.types.indexOf("input-text") == -1) {
          state.types.push("content-text");
        }
      }
    }

    // populate position and event source
    state.xPos = offsetX + aX;
    state.yPos = offsetY + aY;
    state.source = aInputSrc;

    for (let i = 0; i < this._types.length; i++)
      if (this._types[i].handler(state, popupNode))
        state.types.push(this._types[i].name);

    this._previousState = state;

    sendAsyncMessage("Content:ContextMenu", state);
  },

  _getLinkURL: function ch_getLinkURL(aLink) {
    let href = aLink.href;
    if (href)
      return href;

    href = aLink.getAttributeNS(kXLinkNamespace, "href");
    if (!href || !href.match(/\S/)) {
      // Without this we try to save as the current doc,
      // for example, HTML case also throws if empty
      throw "Empty href";
    }

    return Util.makeURLAbsolute(aLink.baseURI, href);
  },

  _getURI: function ch_getURI(aURL) {
    try {
      return Util.makeURI(aURL);
    } catch (ex) { }

    return null;
  },

  _getProtocol: function ch_getProtocol(aURI) {
    if (aURI)
      return aURI.scheme;
    return null;
  },

  /**
   * For add-ons to add new types and data to the ContextMenu message.
   *
   * @param aName A string to identify the new type.
   * @param aHandler A function that takes a state object and a target element.
   *    If aHandler returns true, then aName will be added to the list of types.
   *    The function may also modify the state object.
   */
  registerType: function registerType(aName, aHandler) {
    this._types.push({name: aName, handler: aHandler});
  },

  /** Remove all handlers registered for a given type. */
  unregisterType: function unregisterType(aName) {
    this._types = this._types.filter(function(type) { type.name != aName });
  }
};

ContextMenuHandler.init();
