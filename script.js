(() => {
    const $ = id => document.getElementById(id);
    const drop = $('drop'), input = $('file'), statusEl = $('status');
    let lastBlob = null, lastName = '';

    function show(html, err) {
        statusEl.style.display = 'block';
        statusEl.className = err ? 'err' : '';
        statusEl.innerHTML = html;
    }

    function download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    async function handle(file) {
        if (!file) return;
        if (!/\.sb3$/i.test(file.name)) return show('Select a file with the <b>.sb3</b> extension.', true);
        if (typeof CapivaraObfuscator === 'undefined') return show('Could not load obfuscator.js.', true);
        if (typeof JSZip === 'undefined') return show('Could not load the JSZip library. Check your connection.', true);
        show('Processing <b>' + file.name.replace(/[<>&]/g, '') + '</b>…');
        try {
            const { data, stats } = await CapivaraObfuscator.obfuscateSb3(file, {
                chunk: $('chunk').checked, level: $('chunkLevel').value, bcast: $('bcast').checked,
                nums: $('nums').checked, procs: $('procs').checked, assets: $('assets').checked,
                decoys: $('decoys').checked, comments: $('comments').checked, ids: $('ids').checked
            });
            lastBlob = data;
            lastName = file.name.replace(/\.sb3$/i, '') + '_obfuscated.sb3';
            download(lastBlob, lastName);
            show(`Done! The download of <b>${lastName.replace(/[<>&]/g, '')}</b> has started.
        <div class="stats">
          <div class="stat"><strong>${stats.vars}</strong><span>variables</span></div>
          <div class="stat"><strong>${stats.lists}</strong><span>lists</span></div>
          <div class="stat"><strong>${stats.assets}</strong><span>sprites/costumes/sounds</span></div>
          <div class="stat"><strong>${stats.decoys}</strong><span>decoy blocks</span></div>
          <div class="stat"><strong>${stats.broadcasts}</strong><span>broadcasts</span></div>
          <div class="stat"><strong>${stats.procs}</strong><span>renamed blocks</span></div>
          <div class="stat"><strong>${stats.numRefs}</strong><span>numbers → variables</span></div>
          <div class="stat"><strong>${stats.pieces}</strong><span>chunks created</span></div>
          <div class="stat"><strong>${stats.scripts}</strong><span>scattered scripts</span></div>
        </div>
        ${stats.skipped.length ? '<p>⚠ Not renamed (the project uses names computed at runtime or reads the costume name): ' + stats.skipped.join(', ') + '.</p>' : ''}
        ${stats.bcastSkipped ? '<p>⚠ Broadcasts were not renamed: the project sends broadcasts computed at runtime (renaming would break the logic).</p>' : ''}
        <button id="again">Download again</button>`);
            $('again').onclick = () => download(lastBlob, lastName);
        } catch (e) {
            show('Error: ' + String(e.message || e).replace(/[<>&]/g, ''), true);
        }
    }

    $('chunk').addEventListener('change', e => { $('chunkLevel').disabled = !e.target.checked; });
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    input.addEventListener('change', () => { handle(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handle(e.dataTransfer.files[0]));
})();