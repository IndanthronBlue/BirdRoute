window.addEventListener("load", function () {
  if (typeof L === "undefined") {
    var s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    document.head.appendChild(s);
  }
});
