    (function () {
      try {
        if (!/(^|[?&])from=index([&#]|$)/.test(location.search)) return;
        if (history.replaceState && window.URLSearchParams) {
          var q = new URLSearchParams(location.search);
          q.delete('from');
          history.replaceState(null, '',
            location.pathname + (q.toString() ? '?' + q : '') + location.hash);
        }
        if (window.matchMedia &&
            matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        document.documentElement.classList.add('arriving');
        // Only the trigger. Left on, it would pin the header in its final
        // keyframe and fight anything animating later. Timed from `load`
        // rather than from here: the scripts below block the main thread for a
        // second or more on a cold read, and a timer started in the head would
        // come due before the settle had been seen.
        var off = function () {
          document.documentElement.classList.remove('arriving');
        };
        addEventListener('load', function () { setTimeout(off, 500); });
        setTimeout(off, 8000);            // a load event that never comes
      } catch (e) { /* no transition is not a broken page */ }
    })();
