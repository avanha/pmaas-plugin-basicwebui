(function () {
    // Plain XMLHttpRequest and var, for the old browsers this page is also viewed on.
    var root = document.querySelector("div.entity-logging-levels");

    if (!root) {
        return;
    }

    var selects = root.querySelectorAll("select.level-select");

    Array.prototype.forEach.call(selects, function (select) {
        select.addEventListener("change", function () {
            var row = select.closest("tr");
            var error = row.querySelector(".row-error");
            error.textContent = "";
            select.disabled = true;

            var request = new XMLHttpRequest();
            request.open("POST", "/plugins/basicwebui/logging/level");
            request.setRequestHeader("Content-Type", "application/json");

            request.onload = function () {
                if (request.status >= 200 && request.status < 300) {
                    // Reload so that the components below show the level they now inherit.
                    window.location.reload();
                    return;
                }

                error.textContent = "Could not change it (" + request.status + ")";
                select.disabled = false;
            };

            request.onerror = function () {
                error.textContent = "Could not change it";
                select.disabled = false;
            };

            request.send(JSON.stringify({Component: row.getAttribute("data-component"), Level: select.value}));
        });
    });
})();
