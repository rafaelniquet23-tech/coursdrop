(function(){
  'use strict';
  var CHECK_URL = '/.netlify/functions/check';
  var UPLOAD_URL = '/.netlify/functions/upload';
  var MAX_FILES = 10;
  var DEFAULT_HINT = "Choisis d'où vient ta photo.";

  var $ = function(id){ return document.getElementById(id); };
  var cells = Array.prototype.slice.call(document.querySelectorAll('#pin input'));
  var N = cells.length;
  var msg = $('msg'), panel = $('panel'), lock = $('lock'), unlocked = $('unlocked'), verify = $('verify');
  var views = { choose:$('choose'), picked:$('picked'), done:$('done') };
  var inputs = { camera:$('in-camera'), photos:$('in-photos'), files:$('in-files') };
  var thumbs = $('thumbs'), count = $('count'), sendmsg = $('sendmsg'), sendBtn = $('send'), lycee = $('lycee');
  var classHint = $('classname');
  var fails = 0, blockedUntil = 0, token = '', driveUrl = '', className = '', checking = false;
  var queue = [], seq = 0, sending = false;

  function show(name){
    Object.keys(views).forEach(function(k){ views[k].hidden = (k !== name); });
  }

  function value(){ return cells.map(function(c){ return c.value; }).join(''); }

  function clearCells(){
    cells.forEach(function(c){ c.value = ''; c.classList.remove('filled'); });
  }

  function fail(text){
    msg.textContent = text;
    panel.classList.remove('shake'); void panel.offsetWidth; panel.classList.add('shake');
    clearCells();
    cells[0].focus();
  }

  function unlock(){
    msg.textContent = '';
    clearCells();
    lock.hidden = true; unlocked.hidden = false;
    lycee.hidden = !driveUrl;
    classHint.textContent = className ? 'Classe : ' + className : DEFAULT_HINT;
    if (queue.length) render(); else show('choose');
  }

  function relock(text){
    token = ''; driveUrl = ''; className = '';
    unlocked.hidden = true; lock.hidden = false;
    clearCells();
    msg.textContent = text;
  }

  function check(){
    if (checking) return;
    var now = Date.now();
    if (now < blockedUntil){
      fail("Trop d'essais. Attends " + Math.ceil((blockedUntil - now) / 1000) + " secondes.");
      return;
    }
    var v = value();
    if (v.length < N){ msg.textContent = 'Entre les ' + N + ' chiffres du code.'; return; }
    checking = true; verify.disabled = true; msg.textContent = '';
    fetch(CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: v })
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){ return { status: r.status, body: b }; });
    }).then(function(res){
      if (res.status === 200 && res.body.token){
        token = res.body.token; fails = 0;
        driveUrl = /^https:\/\/drive\.google\.com\//.test(res.body.driveUrl || '') ? res.body.driveUrl : '';
        className = String(res.body.name || '').slice(0, 40);
        unlock();
        return;
      }
      if (res.status === 429){ blockedUntil = Date.now() + 60000; fail("Trop d'essais. Attends une minute."); return; }
      if (res.status === 403){
        fails++;
        if (fails >= 5){ fails = 0; blockedUntil = Date.now() + 15000; fail("Trop d'essais. Attends 15 secondes."); }
        else fail('Code incorrect. Vérifie auprès de ta classe.');
        return;
      }
      fail('Le service ne répond pas. Réessaie dans un instant.');
    }, function(){
      fail('Pas de connexion. Réessaie dans un instant.');
    }).then(function(){ checking = false; verify.disabled = false; });
  }

  cells.forEach(function(c, i){
    c.addEventListener('input', function(){
      c.value = c.value.replace(/\D/g, '').slice(-1);
      c.classList.toggle('filled', !!c.value);
      if (c.value){ msg.textContent = ''; if (i < N - 1) cells[i + 1].focus(); }
      if (value().length === N) check();
    });
    c.addEventListener('keydown', function(e){
      if (e.key === 'Backspace' && !c.value && i > 0){ cells[i - 1].value = ''; cells[i - 1].classList.remove('filled'); cells[i - 1].focus(); }
      else if (e.key === 'ArrowLeft' && i > 0){ cells[i - 1].focus(); }
      else if (e.key === 'ArrowRight' && i < N - 1){ cells[i + 1].focus(); }
      else if (e.key === 'Enter'){ check(); }
    });
    c.addEventListener('paste', function(e){
      var t = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, N);
      if (!t) return;
      e.preventDefault();
      t.split('').forEach(function(d, k){ cells[k].value = d; cells[k].classList.add('filled'); });
      cells[Math.min(t.length, N - 1)].focus();
      if (t.length === N) check();
    });
    c.addEventListener('focus', function(){ c.select(); });
  });
  verify.addEventListener('click', check);

  var touch = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
  if (!touch){
    document.querySelector('[data-src="camera"]').hidden = true;
    document.querySelector('[data-src="photos"]').hidden = true;
    $('files-label').textContent = "Fichiers de l'ordinateur";
  }

  lycee.addEventListener('click', function(){
    if (/^https:\/\/drive\.google\.com\//.test(driveUrl)) window.open(driveUrl, '_blank', 'noopener,noreferrer');
  });

  Array.prototype.forEach.call(document.querySelectorAll('.opt'), function(b){
    b.addEventListener('click', function(){
      var s = b.getAttribute('data-src');
      inputs[s].value = '';
      inputs[s].click();
    });
  });

  function isImage(f){
    return (f.type && f.type.indexOf('image/') === 0) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name);
  }

  function addFiles(list){
    var rejected = 0, extra = 0;
    list.forEach(function(f){
      if (!isImage(f)){ rejected++; return; }
      if (queue.length >= MAX_FILES){ extra++; return; }
      queue.push({ id: ++seq, file: f, url: URL.createObjectURL(f), state: '' });
    });
    render();
    var notes = [];
    if (rejected) notes.push(rejected + ' fichier(s) ignoré(s) : seules les photos sont acceptées.');
    if (extra) notes.push('Maximum ' + MAX_FILES + ' photos à la fois.');
    sendmsg.textContent = notes.join(' ');
  }

  Object.keys(inputs).forEach(function(k){
    inputs[k].addEventListener('change', function(){
      addFiles(Array.prototype.slice.call(inputs[k].files));
    });
  });

  function render(){
    $('back').hidden = true;
    thumbs.textContent = '';
    queue.forEach(function(item){
      var li = document.createElement('li');
      if (item.state) li.className = item.state;
      var img = document.createElement('img');
      img.alt = '';
      img.src = item.url;
      img.addEventListener('error', function(){ img.remove(); li.appendChild(document.createTextNode(item.file.name)); });
      li.appendChild(img);
      if (!sending && item.state !== 'ok'){
        var rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'rm'; rm.setAttribute('aria-label', 'Retirer cette photo');
        rm.addEventListener('click', function(){
          URL.revokeObjectURL(item.url);
          queue = queue.filter(function(q){ return q.id !== item.id; });
          render();
        });
        li.appendChild(rm);
      }
      thumbs.appendChild(li);
    });
    var n = queue.length;
    count.textContent = n + (n > 1 ? ' photos prêtes' : ' photo prête');
    sendBtn.textContent = n > 1 ? 'Envoyer les ' + n + ' photos' : 'Envoyer la photo';
    show(n ? 'picked' : 'choose');
  }

  function shrink(file){
    return createImageBitmap(file).then(function(bmp){
      var s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function(res, rej){
        c.toBlob(function(b){ b ? res(b) : rej(new Error('toBlob')); }, 'image/jpeg', 0.85);
      });
    }).catch(function(err){
      if (file.size <= 4000000 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
      throw err;
    });
  }

  function toBase64(blob){
    return new Promise(function(res, rej){
      var r = new FileReader();
      r.onload = function(){ res(String(r.result).split(',')[1]); };
      r.onerror = function(){ rej(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function uploadOne(item){
    return shrink(item.file).then(function(blob){
      return toBase64(blob).then(function(data){
        var base = item.file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'photo';
        return fetch(UPLOAD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, name: base + '.jpg', data: data })
        });
      });
    }).then(function(r){
      if (r.ok) return;
      return r.json().catch(function(){ return {}; }).then(function(b){
        var e = new Error('HTTP ' + r.status); e.status = r.status; e.code = b.error; throw e;
      });
    });
  }

  function send(){
    if (sending || !queue.length) return;
    sending = true; sendBtn.disabled = true; sendmsg.textContent = '';
    var halt = '';
    var chain = Promise.resolve();
    queue.filter(function(q){ return q.state !== 'ok'; }).forEach(function(item){
      chain = chain.then(function(){
        if (halt) return;
        item.state = 'sending'; render();
        return uploadOne(item).then(function(){ item.state = 'ok'; }, function(err){
          if (err.status === 401) halt = 'session';
          else if (err.status === 429) halt = (err.code === 'quota') ? 'quota' : 'rate';
          item.state = halt ? '' : 'err';
        });
      });
    });
    chain.then(function(){
      sending = false; sendBtn.disabled = false;
      queue.forEach(function(q){ if (q.state === 'sending') q.state = ''; });
      if (halt === 'session'){ render(); relock('Session expirée. Entre à nouveau le code : tes photos sont conservées.'); return; }
      var failed = queue.filter(function(q){ return q.state === 'err'; }).length;
      var left = queue.filter(function(q){ return q.state !== 'ok'; }).length;
      if (!left){ show('done'); return; }
      queue.forEach(function(q){ if (q.state === 'err') q.state = ''; });
      render();
      if (halt === 'quota') sendmsg.textContent = "Limite d'envois du jour atteinte. Réessaie demain.";
      else if (halt === 'rate') sendmsg.textContent = "Trop d'envois d'un coup. Attends une minute puis réessaie.";
      else sendmsg.textContent = failed + (failed > 1 ? " photos n'ont pas pu partir." : " photo n'a pas pu partir.") + ' Réessaie.';
    });
  }

  function reset(){
    queue.forEach(function(q){ URL.revokeObjectURL(q.url); });
    queue = []; sendmsg.textContent = ''; render(); show('choose');
  }

  sendBtn.addEventListener('click', send);
  $('more').addEventListener('click', function(){ sendmsg.textContent = ''; $('back').hidden = false; show('choose'); });
  $('back').addEventListener('click', function(){ $('back').hidden = true; show('picked'); });
  $('again').addEventListener('click', reset);
})();
