(async () => {
    const base = "https://terrazastudios.com/terrazalauncher/backgrounds/";
    const idx = document.body.getAttribute("bkid");
    const exts = ["gif", "jpg", "jpeg", "png", "webp"];

    function exists(url) {
        return new Promise(res => {
            const img = new Image();
            img.onload = () => res(true);
            img.onerror = () => res(false);
            img.src = url + "?v=" + Date.now();
        });
    }

    let finalURL = null;

    for (const ext of exts) {
        const test = `${base}${idx}.${ext}`;
        if (await exists(test)) {
            finalURL = test;
            break;
        }
    }

    if (finalURL) {
        document.body.style.backgroundImage = `url('${finalURL}')`;
    } else {
        console.warn("⚠ No se encontró ninguna imagen para fondo:", idx);
        document.body.style.backgroundImage = "none";
    }
})();
