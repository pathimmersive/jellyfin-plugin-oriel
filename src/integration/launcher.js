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
    function orielBase() {
        var path = window.location.pathname;
        var web = path.toLowerCase().lastIndexOf('/web/');
        return (web >= 0 ? path.slice(0, web) : '') + '/Oriel/';
    }

    function orielUrl(itemId) {
        return orielBase() + '?id=' + encodeURIComponent(itemId);
    }

    // The reading data page, for the book it was opened for when there was one.
    function orielDataUrl(itemId) {
        return orielBase() + 'data.html' + (itemId ? '?id=' + encodeURIComponent(itemId) : '');
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

    // The formats Oriel opens: EPUB books and CBZ comics.
    OrielBookPlayer.prototype.canPlayItem = function (item) {
        return !!(item && typeof item.Path === 'string' && /\.(epub|cbz)$/i.test(item.Path));
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

    // Finishing a sign-in that started in Oriel. The reader leaves a marker with
    // the book's id before sending a signed-out user to the login page, which
    // returns to that book's detail page after sign-in; from there, open the book
    // in Oriel again. The reading data page leaves a marker naming the page
    // ({ page: 'data' }, with the book's id when it had one); sign-in ends on the
    // home page, and from there the data page opens again. The reader's
    // src/session/return.ts uses the same key, age limit and id format.
    var RETURN_KEY = 'oriel_return';
    var RETURN_MAX_AGE_MS = 10 * 60 * 1000;
    var RETURN_CHECK_MS = 300;
    var ITEM_ID = /^[0-9a-f]{32}$/i;

    // The stored marker, {} when one is stored but unreadable, or null.
    function readReturnMarker() {
        var stored;
        try {
            stored = window.localStorage.getItem(RETURN_KEY);
        } catch (e) {
            return null;
        }
        if (!stored) return null;
        try {
            return JSON.parse(stored) || {};
        } catch (e) {
            return {};
        }
    }

    function clearReturnMarker() {
        try {
            window.localStorage.removeItem(RETURN_KEY);
        } catch (e) { /* storage unavailable: nothing to clear */ }
    }

    // The item id of the jellyfin-web detail page being shown, or null.
    function detailsItemId() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/details?') !== 0) return null;
        var params = hash.slice('#/details?'.length).split('&');
        for (var i = 0; i < params.length; i++) {
            if (params[i].indexOf('id=') === 0) return decodeURIComponent(params[i].slice(3));
        }
        return null;
    }

    // Whether jellyfin-web is showing its home page.
    function onHome() {
        var hash = window.location.hash || '';
        return hash === '#/home' || hash.indexOf('#/home?') === 0 || hash.indexOf('#/home.html') === 0;
    }

    function validMarker(marker) {
        if (typeof marker.at !== 'number') return false;
        if (marker.page === 'data') {
            return marker.id === undefined || (typeof marker.id === 'string' && ITEM_ID.test(marker.id));
        }
        return marker.page === undefined && typeof marker.id === 'string' && ITEM_ID.test(marker.id);
    }

    function watchReturn() {
        var marker = readReturnMarker();
        if (!marker) return;
        if (!validMarker(marker)) {
            clearReturnMarker();
            return;
        }
        var toData = marker.page === 'data';
        var timer = null;
        function stop() {
            if (timer !== null) window.clearInterval(timer);
            timer = null;
            window.removeEventListener('hashchange', check);
        }
        function check() {
            var age = Date.now() - marker.at;
            if (age < 0 || age > RETURN_MAX_AGE_MS) {
                clearReturnMarker();
                stop();
            } else if (toData ? onHome() : (detailsItemId() || '').toLowerCase() === marker.id.toLowerCase()) {
                clearReturnMarker();
                stop();
                window.location.replace(toData ? orielDataUrl(marker.id) : orielUrl(marker.id));
            }
        }
        window.addEventListener('hashchange', check);
        timer = window.setInterval(check, RETURN_CHECK_MS);
        check();
    }

    watchReturn();

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
