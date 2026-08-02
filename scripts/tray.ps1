<#
    House Finder - icona nell'area di notifica.

    Node non ha un equivalente di pystray: per mettere un'icona nella tray serve il ciclo di
    messaggi Win32, che vuole un thread suo. Invece di aggiungere un modulo nativo (che andrebbe
    compilato) o un binario di terzi dentro un repo pubblico, si usa quello che Windows ha gia':
    System.Windows.Forms.NotifyIcon, guidato da questo script in un processo figlio.

    L'icona e' DISEGNATA a runtime, come fa pystray in Job e Trip Finder: cosi' non c'e' nessun
    .ico da versionare, e nessuna eccezione da aggiungere al .gitignore (che esclude *.png fuori
    da docs/).

    Il file e' volutamente tutto in ASCII: PowerShell 5.1 rilegge i file come ANSI e le lettere
    accentate diventerebbero mojibake nei menu.

    Lo avvia scripts/serve.ts. Se qualcosa qui dentro fallisce, il server resta acceso senza
    icona: la tray e' una comodita', non un pezzo del funzionamento.
#>
param(
    [Parameter(Mandatory = $true)][string] $Url,
    [Parameter(Mandatory = $true)][int]    $ParentPid
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function New-HouseIcon {
    # La casetta del favicon: bianca su verde salvia (#4a6b52).
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $verde = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 74, 107, 82))
    $bianco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillEllipse($verde, 0, 0, 31, 31)

    # Tetto
    $tetto = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tetto.AddPolygon(@(
        (New-Object System.Drawing.Point 16, 7),
        (New-Object System.Drawing.Point 26, 16),
        (New-Object System.Drawing.Point 6, 16)
    ))
    $g.FillPath($bianco, $tetto)
    # Corpo
    $g.FillRectangle($bianco, 10, 16, 12, 9)
    # Porta, scavata nel verde
    $g.FillRectangle($verde, 14, 19, 4, 6)

    $icona = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $g.Dispose()
    $bmp.Dispose()
    return $icona
}

function Open-App {
    Start-Process $script:Url
}

function Copy-Address {
    # clip.exe c'e' su ogni Windows: nessuna dipendenza, e non serve WinForms clipboard
    # (che da un processo senza finestra a volte non prende).
    $script:Url | clip.exe
}

function Stop-App {
    # Spegnimento ordinato: il server chiude l'http.Server e salva. Se non risponde entro pochi
    # secondi si esce comunque - l'icona non deve restare appesa a un server morto.
    try {
        Invoke-RestMethod -Uri "$($script:Url.TrimEnd('/'))/api/system/shutdown" `
            -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
    } catch {
        # Il server e' gia' giu', o non risponde: si esce lo stesso.
    }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-HouseIcon
$notify.Text = "House Finder - $Url"   # il tooltip dice l'indirizzo: e' l'informazione utile
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$vApri = $menu.Items.Add('Apri House Finder')
$vCopia = $menu.Items.Add('Copia indirizzo')
$menu.Items.Add('-') | Out-Null
$vEsci = $menu.Items.Add('Esci')
$notify.ContextMenuStrip = $menu

$vApri.add_Click({ Open-App })
$vCopia.add_Click({ Copy-Address })
$vEsci.add_Click({
        Stop-App
        $notify.Visible = $false
        $notify.Dispose()
        [System.Windows.Forms.Application]::Exit()
    })
# Click sinistro = la voce predefinita, come in pystray.
$notify.add_MouseClick({
        param($sender, $e)
        if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-App }
    })

# Se il server muore (crash, Ctrl+C, aggiornamento) l'icona deve sparire da sola: un'icona
# fantasma che non apre piu' niente e' peggio di nessuna icona.
$guardia = New-Object System.Windows.Forms.Timer
$guardia.Interval = 2000
$guardia.add_Tick({
        $vivo = $null -ne (Get-Process -Id $script:ParentPid -ErrorAction SilentlyContinue)
        if (-not $vivo) {
            $notify.Visible = $false
            $notify.Dispose()
            [System.Windows.Forms.Application]::Exit()
        }
    })
$guardia.Start()

[System.Windows.Forms.Application]::Run()
