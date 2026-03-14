(() => {
    const REMOTE_VISUAL_REFRESH_INTERVAL_MS = 60000
    const REMOTE_BACKGROUND_BASE = 'https://terrazastudios.com/terrazalauncher/backgrounds/'
    const REMOTE_FLEX_IMAGE_ASSETS = [
        {
            id: 'image_seal',
            baseUrl: 'https://terrazastudios.com/terrazalauncher/iconos/Logo',
            extensions: ['gif', 'png']
        }
    ]
    const REMOTE_LOADING_ASSETS = [
        { id: 'loadCenterImage', url: 'https://terrazastudios.com/terrazalauncher/iconos/LoadingSeal.png' },
        { id: 'loadSpinnerImage', url: 'https://terrazastudios.com/terrazalauncher/iconos/LoadingText.png' }
    ]
    const REMOTE_BACKGROUND_EXTENSIONS = ['gif', 'jpg', 'jpeg', 'png', 'webp']

    let remoteVisualRefreshInFlight = false
    let lastRemoteVisualRefreshToken = null
    let activeBackgroundBaseUrl = null

    function getRemoteVisualRefreshToken(force = false) {
        const token = Math.floor(Date.now() / REMOTE_VISUAL_REFRESH_INTERVAL_MS)
        return force ? `${token}-${Date.now()}` : `${token}`
    }

    function withRemoteVisualRefreshToken(url, token) {
        const parsed = new URL(url)
        parsed.searchParams.set('launcherRefresh', token)
        return parsed.toString()
    }

    function waitForImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(url)
            img.onerror = () => reject(new Error(`Unable to load image: ${url}`))
            img.src = url
        })
    }

    async function resolveRemoteBackgroundBaseUrl(token) {
        const idx = document.body.getAttribute('bkid')
        const candidates = []

        if(activeBackgroundBaseUrl != null) {
            candidates.push(activeBackgroundBaseUrl)
        }

        for(const ext of REMOTE_BACKGROUND_EXTENSIONS) {
            const candidate = `${REMOTE_BACKGROUND_BASE}${idx}.${ext}`
            if(!candidates.includes(candidate)) {
                candidates.push(candidate)
            }
        }

        for(const candidate of candidates) {
            try {
                await waitForImage(withRemoteVisualRefreshToken(candidate, token))
                activeBackgroundBaseUrl = candidate
                return candidate
            } catch (err) {
                // Try the next known extension.
            }
        }

        return null
    }

    function refreshRemoteImageElement(asset, token) {
        const element = document.getElementById(asset.id)
        if(element == null) {
            return
        }

        const nextSource = withRemoteVisualRefreshToken(asset.url, token)
        if(element.dataset.remoteSource === nextSource) {
            return
        }

        element.dataset.remoteSource = nextSource
        element.src = nextSource
    }

    async function resolveRemoteImageAssetUrl(asset, token) {
        const element = document.getElementById(asset.id)
        const candidates = []

        if(element?.dataset.assetBaseUrl != null && element.dataset.assetBaseUrl.length > 0) {
            candidates.push(element.dataset.assetBaseUrl)
        }

        for(const ext of asset.extensions) {
            const candidate = `${asset.baseUrl}.${ext}`
            if(!candidates.includes(candidate)) {
                candidates.push(candidate)
            }
        }

        for(const candidate of candidates) {
            try {
                await waitForImage(withRemoteVisualRefreshToken(candidate, token))
                return candidate
            } catch (err) {
                // Try the next known extension.
            }
        }

        return null
    }

    async function refreshFlexibleRemoteImageElement(asset, token) {
        const element = document.getElementById(asset.id)
        if(element == null) {
            return
        }

        const assetBaseUrl = await resolveRemoteImageAssetUrl(asset, token)
        if(assetBaseUrl == null) {
            return
        }

        const nextSource = withRemoteVisualRefreshToken(assetBaseUrl, token)
        if(element.dataset.remoteSource === nextSource) {
            return
        }

        element.dataset.assetBaseUrl = assetBaseUrl
        element.dataset.remoteSource = nextSource
        element.src = nextSource
    }

    async function applyRemoteBackground(token) {
        const backgroundBaseUrl = await resolveRemoteBackgroundBaseUrl(token)
        if(backgroundBaseUrl == null) {
            if(document.body.dataset.remoteBackgroundSource == null) {
                document.body.style.backgroundImage = 'none'
            }
            return
        }

        const nextBackgroundUrl = withRemoteVisualRefreshToken(backgroundBaseUrl, token)
        if(document.body.dataset.remoteBackgroundSource === nextBackgroundUrl) {
            return
        }

        await waitForImage(nextBackgroundUrl)
        document.body.dataset.remoteBackgroundSource = nextBackgroundUrl
        document.body.style.backgroundImage = `url('${nextBackgroundUrl}')`
    }

    async function refreshRemoteVisualAssets(force = false) {
        if(remoteVisualRefreshInFlight) {
            return
        }

        const token = getRemoteVisualRefreshToken(force)
        if(!force && token === lastRemoteVisualRefreshToken) {
            return
        }

        remoteVisualRefreshInFlight = true
        lastRemoteVisualRefreshToken = token

        try {
            for(const asset of REMOTE_LOADING_ASSETS) {
                refreshRemoteImageElement(asset, token)
            }
            for(const asset of REMOTE_FLEX_IMAGE_ASSETS) {
                await refreshFlexibleRemoteImageElement(asset, token)
            }
            await applyRemoteBackground(token)
        } catch (err) {
            console.warn('Unable to refresh remote launcher assets.', err)
        } finally {
            remoteVisualRefreshInFlight = false
        }
    }

    window.refreshRemoteVisualAssets = refreshRemoteVisualAssets

    window.addEventListener('focus', () => {
        refreshRemoteVisualAssets()
    })

    document.addEventListener('visibilitychange', () => {
        if(!document.hidden) {
            refreshRemoteVisualAssets()
        }
    })

    refreshRemoteVisualAssets(true)
    setInterval(() => {
        refreshRemoteVisualAssets()
    }, REMOTE_VISUAL_REFRESH_INTERVAL_MS)
})()