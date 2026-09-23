  (function () {
    var ZONES = {
      "Asia/Hong_Kong": [22.3, 114.2], "Asia/Seoul": [37.6, 127.0], "Asia/Tokyo": [35.7, 139.7],
      "Asia/Shanghai": [31.2, 121.5], "Asia/Taipei": [25.0, 121.6], "Asia/Singapore": [1.3, 103.8],
      "Asia/Kolkata": [28.6, 77.2], "Asia/Dubai": [25.2, 55.3], "Australia/Sydney": [-33.9, 151.2],
      "Australia/Melbourne": [-37.8, 145.0], "Pacific/Auckland": [-36.8, 174.8],
      "Europe/London": [51.5, -0.1], "Europe/Dublin": [53.3, -6.3], "Europe/Paris": [48.9, 2.4],
      "Europe/Berlin": [52.5, 13.4], "Europe/Amsterdam": [52.4, 4.9], "Europe/Madrid": [40.4, -3.7],
      "Europe/Rome": [41.9, 12.5], "Europe/Stockholm": [59.3, 18.1], "Europe/Helsinki": [60.2, 24.9],
      "Europe/Moscow": [55.8, 37.6], "Europe/Istanbul": [41.0, 29.0], "Europe/Lisbon": [38.7, -9.1],
      "America/New_York": [40.7, -74.0], "America/Toronto": [43.7, -79.4], "America/Chicago": [41.9, -87.6],
      "America/Denver": [39.7, -105.0], "America/Los_Angeles": [34.1, -118.2], "America/Vancouver": [49.3, -123.1],
      "America/Mexico_City": [19.4, -99.1], "America/Sao_Paulo": [-23.5, -46.6],
      "America/Argentina/Buenos_Aires": [-34.6, -58.4], "America/Bogota": [4.7, -74.1],
      "Africa/Cairo": [30.0, 31.2], "Africa/Johannesburg": [-26.2, 28.0], "Africa/Lagos": [6.5, 3.4],
      "Africa/Nairobi": [-1.3, 36.8]
    };
    var COOKIE = "samhan_theme";
    function place() {
      var tz = "";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
      if (ZONES[tz]) return ZONES[tz];
      var lon = -new Date().getTimezoneOffset() / 60 * 15;
      return [35, Math.max(-180, Math.min(180, lon))];
    }
    function sunUTC(rising, lat, lon, d) {
      var rad = Math.PI / 180;
      var start = Date.UTC(d.getUTCFullYear(), 0, 0);
      var N = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 864e5);
      var lngHour = lon / 15;
      var t = N + (((rising ? 6 : 18) - lngHour) / 24);
      var M = (0.9856 * t) - 3.289;
      var L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
      L = (L + 720) % 360;
      var RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad; RA = (RA + 720) % 360;
      RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
      var sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
      var cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
      if (cosH > 1) return rising ? Infinity : -Infinity;
      if (cosH < -1) return rising ? -Infinity : Infinity;
      var H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
      var T = H + RA - (0.06571 * t) - 6.622;
      var UT = (T - lngHour) % 24; if (UT < 0) UT += 24;
      return UT;
    }
    function sun(now) {
      now = now || new Date();
      var p = place(), lat = p[0], lon = p[1];
      var rise = sunUTC(true, lat, lon, now), set = sunUTC(false, lat, lon, now);
      if (rise === Infinity) return "dark";
      if (rise === -Infinity) return "light";
      var h = now.getUTCHours() + now.getUTCMinutes() / 60;
      var day = rise < set ? (h >= rise && h < set) : (h >= rise || h < set);
      return day ? "light" : "dark";
    }
    function readCookie() {
      var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=(light|dark)"));
      return m ? m[1] : null;
    }
    function secondsToMidnight() {
      var n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
      return Math.max(60, Math.floor((m - n) / 1000));
    }
    function writeCookie(v, maxAge) {
      var host = location.hostname, parts = [COOKIE + "=" + (v || ""), "Path=/", "Max-Age=" + maxAge, "SameSite=Lax"];
      if (/(^|\.)samhan\.ai$/.test(host)) parts.push("Domain=.samhan.ai");
      if (location.protocol === "https:") parts.push("Secure");
      document.cookie = parts.join("; ");
    }
    function effective() { return readCookie() || sun(); }
    function apply(t) {
      t = t || effective();
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.dispatchEvent(new CustomEvent("samhan-theme", { detail: t }));
      return t;
    }
    function set(t) { writeCookie(t, secondsToMidnight()); return apply(t); }
    function clear() { writeCookie("", 0); return apply(); }
    function isAuto() { return !readCookie(); }
    function auto() { return apply(sun()); }                                    // back to daylight
    function cycle() {
      /* Three states, and every press changes something a reader can see or
         rely on: daylight → hold the other sheet → hold the one daylight would
         have chosen → daylight again. A held choice expires at midnight. */
      var held = readCookie(), s = sun();
      if (!held) return set(s === "light" ? "dark" : "light");
      if (held !== s) return set(s);
      clear(); return "auto";
    }
    apply();
    setInterval(function () { if (!readCookie()) apply(sun()); }, 60000);
    window.SamhanTheme = { effective: effective, set: set, clear: clear, sun: sun, apply: apply,
                           isAuto: isAuto, auto: auto, cycle: cycle };
  })();
