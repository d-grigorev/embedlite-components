/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;

const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

function debug(aMsg) {
  Logger.debug("PrivateDataManager.js:", aMsg);
}

function PrivateDataManager() {
  Logger.debug("JSComp: PrivateDataManager.js loaded");
}

PrivateDataManager.prototype = {
  classID: Components.ID("{6a7dd2ef-b7c8-4ab5-8c35-c0e5d7557ccf}"),
  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

  get loginManager() {
    return Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);
  },

  get cookieManager() {
    return Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager);
  },

  clearCaches: function() {
    var cache = Cc["@mozilla.org/netwerk/cache-storage-service;1"].getService(Ci.nsICacheStorageService);
    try {
      cache.clear();
    } catch(e) {
      debug("error in clearing storage cache: " + e);
    }

    var imageCache = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools).getImgCacheForDocument(null);
    try {
      imageCache.clearCache(false); // true=chrome, false=content
    } catch(e) {
      debug("error in clearing image cache: " + e);
    }
  },

  clearPrivateData: function (aData) {
    switch (aData) {
      case "passwords": {
        this.loginManager.removeAllLogins();
        debug("Passwords removed");
        break;
      }
      case "cookies": {
        this.cookieManager.removeAll();
        debug("Cookies removed");
        break;
      }
      case "cache": {
        this.clearCaches()
        debug("Cache cleaned");
        break;
      }
    }
  },

  observe: function (aSubject, aTopic, aData) {
    switch (aTopic) {
      case "app-startup": {
        Services.obs.addObserver(this, "clear-private-data", true);
        break;
      }
      case "clear-private-data": {
        this.clearPrivateData(aData);
        break;
      }
    }
  }
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([PrivateDataManager]);
