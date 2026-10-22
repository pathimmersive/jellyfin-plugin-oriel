// Loaded by jellyfin-web as a classic script before its own bundles run.
// Defines a book player that jellyfin-web loads by name from config.json;
// at priority 0 it is chosen ahead of the built-in book player for EPUB
// items and opens them in Oriel instead.
(function () {
    'use strict';

    var PLAYER_NAME = 'OrielBookPlayer';
    // How long after the page loads jellyfin-web has to ask for the player.
    var LOAD_WAIT_MS = 10000;
    var requested = false;

    // jellyfin-web lives at {base}/web/, Oriel at {base}/Oriel/.
    function orielUrl(itemId) {
        var path = window.location.pathname;
        var web = path.toLowerCase().lastIndexOf('/web/');
        var base = web >= 0 ? path.slice(0, web) : '';
        return base + '/Oriel/?id=' + encodeURIComponent(itemId);
    }

    function OrielBookPlayer() {
        this.name = 'Oriel';
        this.type = 'mediaplayer';
        this.id = 'orielbookplayer';
        this.priority = 0;
        this.isLocalPlayer = true;
    }

    OrielBookPlayer.prototype.canPlayMediaType = function (mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    };

    OrielBookPlayer.prototype.canPlayItem = function (item) {
        return !!(item && typeof item.Path === 'string' && /\.epub$/i.test(item.Path));
    };

    OrielBookPlayer.prototype.play = function (options) {
        var item = options && options.items && options.items[0];
        if (!item || !item.Id) {
            return Promise.reject(new Error('Oriel: no book to open'));
        }
        window.location.assign(orielUrl(item.Id));
        return Promise.resolve();
    };

    // The rest of the player interface; the page navigates away before any of it matters.
    OrielBookPlayer.prototype.stop = function () { return Promise.resolve(); };
    OrielBookPlayer.prototype.destroy = function () {};
    OrielBookPlayer.prototype.currentItem = function () { return null; };
    OrielBookPlayer.prototype.currentTime = function () { return 0; };
    OrielBookPlayer.prototype.duration = function () { return 0; };
    OrielBookPlayer.prototype.paused = function () { return false; };
    OrielBookPlayer.prototype.volume = function () { return 100; };
    OrielBookPlayer.prototype.isMuted = function () { return false; };

    window[PLAYER_NAME] = function () {
        requested = true;
        return Promise.resolve(OrielBookPlayer);
    };

    // If jellyfin-web never asks for the player, its plugin loading has changed;
    // say so once and leave the stock players alone.
    window.addEventListener('load', function () {
        setTimeout(function () {
            if (!requested) {
                console.warn('Oriel: jellyfin-web did not load ' + PLAYER_NAME + '; Play keeps the built-in book player.');
            }
        }, LOAD_WAIT_MS);
    });
})();
