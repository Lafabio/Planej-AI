// ============================================================
//  EDUPLAN — script.js
//  Firebase Auth + Firestore | Multiusuário | Multiescola
//  Funcionalidades:
//    • Login/Cadastro/Recuperação de senha seguro
//    • Visualizar senha (toggle)
//    • Força da senha em tempo real
//    • Múltiplas escolas com horários próprios
//    • Configuração de horário: nº de aulas, recreio, hora início, duração
//    • Paleta de cores por escola (pré-sets + custom)
//    • Logo da escola por drag & drop
//    • Painel Admin: gerenciar escolas e usuários
//    • Perfil do usuário: nome, disciplinas, senha
// ============================================================

import { initializeApp }                        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut,
    onAuthStateChanged, sendPasswordResetEmail,
    updateProfile, updatePassword,
    EmailAuthProvider, reauthenticateWithCredential
}                                                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore, doc, setDoc, getDoc, updateDoc,
    deleteDoc, collection, getDocs, query, where,
    serverTimestamp
}                                                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ──────────────────────────────────────────────────────────
//  ⚙️  CONFIGURAÇÃO FIREBASE
// ──────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyDQHCEOoFwajMXbFppYnEv2wQs64uiLUF8",
    authDomain:        "eduplan-app-abfeb.firebaseapp.com",
    projectId:         "eduplan-app-abfeb",
    storageBucket:     "eduplan-app-abfeb.firebasestorage.app",
    messagingSenderId: "278323138478",
    appId:             "1:278323138478:web:bf5d17c3bbda8c4ce5823f"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ──────────────────────────────────────────────────────────
//  EMAIL DO SUPER-ADMINISTRADOR
// ──────────────────────────────────────────────────────────
const EMAIL_SUPERADMIN = "prof.lafa@gmail.com";

// ──────────────────────────────────────────────────────────
//  UTILITÁRIO — SANITIZAR PARA FIRESTORE
// ──────────────────────────────────────────────────────────
function sanitizarParaFirestore(obj) {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) {
        const result = {};
        obj.forEach((v, i) => { result[String(i)] = sanitizarParaFirestore(v); });
        return result;
    }
    if (typeof obj === 'object') {
        const result = {};
        for (const k in obj) {
            result[k] = sanitizarParaFirestore(obj[k]);
        }
        return result;
    }
    return obj === undefined ? null : obj;
}

function desserializarDoFirestore(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const keys = Object.keys(obj);
    const isArrayLike = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
    if (isArrayLike) {
        const arr = [];
        keys.forEach(k => { arr[parseInt(k)] = desserializarDoFirestore(obj[k]); });
        return arr;
    }
    const result = {};
    for (const k in obj) {
        result[k] = desserializarDoFirestore(obj[k]);
    }
    return result;
}

// ──────────────────────────────────────────────────────────
//  PALETAS PRÉ-DEFINIDAS
// ──────────────────────────────────────────────────────────
const PALETAS = [
    { id: 'azul',     nome: 'Azul Clássico',   primary: '#0047B6', primaryDark: '#003490', accent: '#F2B817' },
    { id: 'verde',    nome: 'Verde Natureza',   primary: '#1a6b3c', primaryDark: '#14532d', accent: '#f59e0b' },
    { id: 'roxo',     nome: 'Roxo Criativo',    primary: '#6d28d9', primaryDark: '#4c1d95', accent: '#f472b6' },
    { id: 'vermelho', nome: 'Vermelho Forte',   primary: '#b91c1c', primaryDark: '#7f1d1d', accent: '#fbbf24' },
    { id: 'laranja',  nome: 'Laranja Vibrante', primary: '#c2410c', primaryDark: '#7c2d12', accent: '#06b6d4' },
    { id: 'grafite',  nome: 'Grafite Moderno',  primary: '#1e293b', primaryDark: '#0f172a', accent: '#38bdf8' },
    { id: 'custom',   nome: 'Personalizado',    primary: '#0047B6', primaryDark: '#003490', accent: '#F2B817' },
];

const DISCIPLINAS_PADRAO = [
    { id: "biologia",             nome: "Biologia",             icone: "🧬" },
    { id: "biohackeria",          nome: "Biohackeria",          icone: "🔬" },
    { id: "projetos_livres",      nome: "Projetos Livres",      icone: "💡" },
    { id: "robotica",             nome: "Robótica",             icone: "🤖" },
    { id: "apps_games",           nome: "Apps e Games",         icone: "🎮" },
    { id: "iniciacao_cientifica", nome: "Iniciação Científica", icone: "🔍" },
    { id: "outra",                nome: "Outra",                icone: "📝" }
];

const TURMAS_PADRAO = ['101','102','201','202','301','302'];
const DIAS_SEMANA   = ['SEG','TER','QUA','QUI','SEX'];
const DIAS_COMPLETO = ['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira'];

// ──────────────────────────────────────────────────────────
//  ESTADO GLOBAL
// ──────────────────────────────────────────────────────────
let usuarioLogado    = null;
let perfilUsuario    = null;
let escolaAtual      = null;
let semanas          = [];
let semanaAtual      = -1;
let planejamentos    = {};
let horarioProfessor = {};
let saveTimer        = null;
let logoBase64       = null;

// Estado do perfil
let _perfilDisciplinas = [];

// ──────────────────────────────────────────────────────────
//  HORÁRIOS CALCULADOS DINAMICAMENTE
// ──────────────────────────────────────────────────────────
function calcularHorarios(config) {
    const horarios = [];
    const breaks   = [];
    let [h, m] = (config.horaInicio || '07:15').split(':').map(Number);
    const dur  = parseInt(config.duracaoAula   || 45);
    const nAu  = parseInt(config.numAulas       || 7);
    const durR = parseInt(config.duracaoRecreo  || 15);
    const posR = parseInt(config.posicaoRecreo  || 3);

    for (let i = 0; i < nAu; i++) {
        const ini = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        m += dur;
        if (m >= 60) { h += Math.floor(m/60); m = m % 60; }
        const fim = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        horarios.push(`${ini} – ${fim}`);
        breaks.push(false);

        if (i === posR - 1 && posR < nAu) {
            breaks.push(true);
            horarios.push(`RECREIO (${durR} min)`);
            m += durR;
            if (m >= 60) { h += Math.floor(m/60); m = m % 60; }
        }
    }
    return { horarios, breaks };
}

// ──────────────────────────────────────────────────────────
//  UTILITÁRIOS
// ──────────────────────────────────────────────────────────
function mostrarLoading(show = true) {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function showToast(msg, tipo = '') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + tipo;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3500);
}

function setBtn(id, disabled) {
    const b = document.getElementById(id);
    if (b) b.disabled = disabled;
}

function aplicarTema(paleta) {
    if (!paleta) return;
    const r = document.documentElement.style;
    r.setProperty('--primary',       paleta.primary      || '#0047B6');
    r.setProperty('--primary-dark',  paleta.primaryDark  || '#003490');
    r.setProperty('--primary-light', hexAlpha(paleta.primary || '#0047B6', .1));
    r.setProperty('--accent',        paleta.accent       || '#F2B817');
}

function hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function _escaparHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────
//  TOGGLE DE SENHA (olho) — login/cadastro
// ──────────────────────────────────────────────────────────
window.toggleSenha = function(id, btn) {
    const inp = document.getElementById(id);
    if (!inp) return;
    const isText = inp.type === 'text';
    inp.type = isText ? 'password' : 'text';
    btn.style.color = isText ? '' : 'var(--primary)';
};

// ──────────────────────────────────────────────────────────
//  FORÇA DA SENHA (cadastro)
// ──────────────────────────────────────────────────────────
function setupStrengthMeter() {
    const inp   = document.getElementById('cadastroSenha');
    const fill  = document.querySelector('.strength-fill');
    const label = document.getElementById('strengthLabel');
    if (!inp || !fill) return;
    inp.addEventListener('input', () => {
        const v = inp.value;
        let score = 0;
        if (v.length >= 6)  score++;
        if (v.length >= 10) score++;
        if (/[A-Z]/.test(v)) score++;
        if (/[0-9]/.test(v)) score++;
        if (/[^A-Za-z0-9]/.test(v)) score++;
        const pct    = (score / 5) * 100;
        const cores  = ['#ef4444','#f97316','#eab308','#22c55e','#16a34a'];
        const labels = ['Muito fraca','Fraca','Razoável','Boa','Forte'];
        fill.style.width      = pct + '%';
        fill.style.background = cores[score - 1] || '#e5e7eb';
        label.textContent     = v.length ? labels[score - 1] || '' : '';
        label.style.color     = cores[score - 1] || 'transparent';
    });
}

// ──────────────────────────────────────────────────────────
//  AUTH STATE OBSERVER
// ──────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    mostrarLoading(true);
    if (user) {
        usuarioLogado = user;
        await carregarPerfil();
        await carregarEscola();
        await carregarDados();
        iniciarAplicacao();
    } else {
        usuarioLogado = null;
        perfilUsuario = null;
        escolaAtual   = null;
        mostrarTelaLogin();
    }
    mostrarLoading(false);
});

// ──────────────────────────────────────────────────────────
//  NAVEGAÇÃO ENTRE FORMULÁRIOS
// ──────────────────────────────────────────────────────────
function mostrarLogin() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('cadastroForm').classList.add('hidden');
    document.getElementById('recuperacaoForm').classList.add('hidden');
}

function mostrarCadastro() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('cadastroForm').classList.remove('hidden');
    document.getElementById('recuperacaoForm').classList.add('hidden');
    setupStrengthMeter();
}

function mostrarRecuperacao() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('cadastroForm').classList.add('hidden');
    document.getElementById('recuperacaoForm').classList.remove('hidden');
}

function mostrarTelaLogin() {
    document.getElementById('telaLogin').classList.remove('hidden');
    document.getElementById('appPrincipal').classList.add('hidden');
    mostrarLogin();
}

// ──────────────────────────────────────────────────────────
//  LOGIN
// ──────────────────────────────────────────────────────────
async function fazerLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const senha = document.getElementById('loginSenha').value;
    if (!email || !senha) { showToast('Preencha email e senha', 'error'); return; }
    setBtn('btnEntrar', true);
    mostrarLoading(true);
    try {
        await signInWithEmailAndPassword(auth, email, senha);
    } catch(e) {
        mostrarLoading(false);
        setBtn('btnEntrar', false);
        const msgs = {
            'auth/user-not-found':    'Usuário não encontrado.',
            'auth/wrong-password':    'Senha incorreta.',
            'auth/invalid-email':     'Email inválido.',
            'auth/invalid-credential':'Email ou senha inválidos.',
            'auth/too-many-requests': 'Muitas tentativas. Aguarde e tente novamente.'
        };
        showToast(msgs[e.code] || 'Erro ao entrar: ' + e.message, 'error');
    }
}

// ──────────────────────────────────────────────────────────
//  CADASTRO
// ──────────────────────────────────────────────────────────
async function fazerCadastro() {
    const nome  = document.getElementById('cadastroNome').value.trim();
    const email = document.getElementById('cadastroEmail').value.trim();
    const senha = document.getElementById('cadastroSenha').value;
    const conf  = document.getElementById('cadastroConfirmarSenha').value;

    if (!nome || !email || !senha || !conf) { showToast('Preencha todos os campos', 'error'); return; }
    if (senha.length < 6) { showToast('A senha deve ter pelo menos 6 caracteres', 'error'); return; }
    if (senha !== conf)   { showToast('As senhas não coincidem', 'error'); return; }

    setBtn('btnCadastrar', true);
    mostrarLoading(true);
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, senha);
        await updateProfile(cred.user, { displayName: nome });
        await setDoc(doc(db, 'usuarios', cred.user.uid), {
            nome, email,
            escolaId:    null,
            tipo:        email === EMAIL_SUPERADMIN ? 'superadmin' : 'professor',
            disciplinas: [],
            dataCadastro: new Date().toISOString()
        });
        showToast('Conta criada com sucesso! 🎉', 'success');
    } catch(e) {
        mostrarLoading(false);
        setBtn('btnCadastrar', false);
        const msgs = {
            'auth/email-already-in-use': 'Este email já está cadastrado.',
            'auth/invalid-email':        'Email inválido.',
            'auth/weak-password':        'Senha muito fraca.'
        };
        showToast(msgs[e.code] || 'Erro no cadastro: ' + e.message, 'error');
    }
}

// ──────────────────────────────────────────────────────────
//  RECUPERAÇÃO DE SENHA
// ──────────────────────────────────────────────────────────
async function iniciarRecuperacao() {
    const email = document.getElementById('recuperacaoEmail').value.trim();
    if (!email) { showToast('Digite seu email', 'error'); return; }
    mostrarLoading(true);
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Email de recuperação enviado! Verifique sua caixa de entrada.', 'success');
        mostrarLogin();
    } catch(e) {
        showToast(e.code === 'auth/user-not-found' ? 'Email não cadastrado.' : 'Erro: ' + e.message, 'error');
    } finally {
        mostrarLoading(false);
    }
}

// ──────────────────────────────────────────────────────────
//  LOGOUT
// ──────────────────────────────────────────────────────────
async function fazerLogout() {
    if (!confirm('Deseja realmente sair?')) return;
    mostrarLoading(true);
    await signOut(auth);
}

// ──────────────────────────────────────────────────────────
//  CARREGAR PERFIL
// ──────────────────────────────────────────────────────────
async function carregarPerfil() {
    if (!usuarioLogado) return;
    try {
        const snap = await getDoc(doc(db, 'usuarios', usuarioLogado.uid));
        if (snap.exists()) {
            perfilUsuario = snap.data();
        } else {
            perfilUsuario = {
                nome:        usuarioLogado.displayName || usuarioLogado.email,
                email:       usuarioLogado.email,
                tipo:        usuarioLogado.email === EMAIL_SUPERADMIN ? 'superadmin' : 'professor',
                disciplinas: [],
                dataCadastro: new Date().toISOString()
            };
            await setDoc(doc(db, 'usuarios', usuarioLogado.uid), perfilUsuario);
        }
    } catch(e) { console.error('Perfil:', e); }
}

// ──────────────────────────────────────────────────────────
//  CARREGAR ESCOLA DO USUÁRIO
// ──────────────────────────────────────────────────────────
async function carregarEscola() {
    if (!perfilUsuario?.escolaId) { escolaAtual = null; return; }
    try {
        const snap = await getDoc(doc(db, 'escolas', perfilUsuario.escolaId));
        if (snap.exists()) {
            escolaAtual = { id: snap.id, ...snap.data() };
            aplicarTema(escolaAtual.paleta || PALETAS[0]);
            atualizarBrandingEscola();
        }
    } catch(e) { console.error('Escola:', e); }
}

function atualizarBrandingEscola() {
    if (!escolaAtual) return;
    const nomeEl = document.getElementById('topbarEscolaNome');
    if (nomeEl) nomeEl.textContent = escolaAtual.nome || 'EduPlan';
    const topLogo = document.getElementById('topbarLogo');
    const topIcon = document.getElementById('topbarIcon');
    if (escolaAtual.logoBase64) {
        topLogo.src = escolaAtual.logoBase64;
        topLogo.classList.remove('hidden');
        if (topIcon) topIcon.style.display = 'none';
    }
    const brandLogo = document.getElementById('brandLogo');
    const brandIcon = document.getElementById('brandIcon');
    if (brandLogo && escolaAtual.logoBase64) {
        brandLogo.src = escolaAtual.logoBase64;
        brandLogo.classList.remove('hidden');
        if (brandIcon) brandIcon.style.display = 'none';
    }
}

// ──────────────────────────────────────────────────────────
//  CARREGAR DADOS DO USUÁRIO
// ──────────────────────────────────────────────────────────
async function carregarDados() {
    if (!usuarioLogado) return;
    try {
        const uid = usuarioLogado.uid;
        const [planSnap, horSnap, confSnap] = await Promise.all([
            getDoc(doc(db, 'planejamentos', uid)),
            getDoc(doc(db, 'horarios',      uid)),
            getDoc(doc(db, 'configuracoes', uid))
        ]);
        planejamentos    = planSnap.exists() ? desserializarDoFirestore(planSnap.data().dados || {}) : {};
        horarioProfessor = horSnap.exists()  ? desserializarDoFirestore(horSnap.data().grade  || {}) : {};

        if (confSnap.exists() && confSnap.data().dataInicioLetivo) {
            const dataInicio = confSnap.data().dataInicioLetivo;
            const el = document.getElementById('inicioLetivo');
            if (el) {
                el.value = dataInicio;
                setTimeout(() => gerarSemanas(dataInicio), 300);
            }
        }
    } catch(e) { console.error('Dados:', e); }
}

// ──────────────────────────────────────────────────────────
//  SALVAR
// ──────────────────────────────────────────────────────────
async function salvarPlanejamentos() {
    if (!usuarioLogado) return;
    try {
        await setDoc(doc(db, 'planejamentos', usuarioLogado.uid), { dados: sanitizarParaFirestore(planejamentos) });
    } catch(e) {
        console.error('Erro ao salvar planejamentos:', e);
        showToast('Erro ao salvar: ' + e.message, 'error');
    }
}

function salvarPlanejamentosDebounce() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(salvarPlanejamentos, 1200);
}

async function salvarHorarioFirestore() {
    if (!usuarioLogado) return;
    await setDoc(doc(db, 'horarios', usuarioLogado.uid), { grade: sanitizarParaFirestore(horarioProfessor) });
}

async function salvarDataInicioLetivo(dataISO) {
    if (!usuarioLogado) return;
    await setDoc(doc(db, 'configuracoes', usuarioLogado.uid), { dataInicioLetivo: dataISO }, { merge: true });
}

// ──────────────────────────────────────────────────────────
//  INICIAR APLICAÇÃO
// ──────────────────────────────────────────────────────────
function iniciarAplicacao() {
    document.getElementById('telaLogin').classList.remove('hidden');
    document.getElementById('telaLogin').classList.add('hidden');
    document.getElementById('appPrincipal').classList.remove('hidden');
    setupEventListeners();
    atualizarInterface();

    if (!perfilUsuario?.escolaId) {
        abrirModalSelecionarEscola();
    }
}

// ──────────────────────────────────────────────────────────
//  MODAL — SELECIONAR ESCOLA
// ──────────────────────────────────────────────────────────
async function abrirModalSelecionarEscola() {
    mostrarLoading(true);
    let escolas = [];
    try {
        const snap = await getDocs(collection(db, 'escolas'));
        snap.forEach(d => escolas.push({ id: d.id, ...d.data() }));
    } catch(e) { /* pode não ter escolas ainda */ }
    mostrarLoading(false);

    const isSuperAdmin = perfilUsuario?.tipo === 'superadmin';

    const modal = document.createElement('div');
    modal.id = 'modalSelecionarEscola';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'z-index:2000;';

    modal.innerHTML = `
    <div class="modal-box modal-sm">
        <div class="modal-header" style="border-bottom:none;padding-bottom:4px;">
            <h3>🏫 Associe sua Escola</h3>
        </div>
        <p style="color:var(--text-muted);margin-bottom:22px;font-size:14px;line-height:1.7;">
            Antes de continuar, vincule sua conta a uma escola.
            ${isSuperAdmin ? 'Como superadministrador, você também pode <strong>criar uma nova escola</strong>.' : ''}
        </p>

        ${escolas.length > 0 ? `
        <div class="field-group">
            <label>Selecione uma escola existente</label>
            <select id="selectEscolaVinculo" style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:var(--radius);font-size:15px;font-family:var(--font-body);outline:none;">
                <option value="">— escolha uma escola —</option>
                ${escolas.map(e => `<option value="${e.id}">${e.nome}${e.cidade ? ' · ' + e.cidade : ''}</option>`).join('')}
            </select>
        </div>
        <button class="btn-primary" onclick="vincularEscolaExistente()" style="margin-bottom:16px;">Vincular a esta escola</button>
        ${isSuperAdmin ? `<div style="text-align:center;color:var(--text-muted);font-size:13px;margin-bottom:16px;">— ou —</div>` : ''}
        ` : `
        <p style="background:var(--primary-light);color:var(--primary);padding:14px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:16px;">
            Nenhuma escola cadastrada ainda.
        </p>
        `}

        ${isSuperAdmin ? `
        <button class="btn-outline" onclick="fecharModalSelecionarEscola(); abrirModalNovaEscolaEVincular();" style="width:100%;">
            + Criar nova escola
        </button>` : ''}

        <div style="margin-top:16px;text-align:center;">
            <a href="#" onclick="fazerLogout()" style="font-size:12px;color:var(--text-muted);">Sair da conta</a>
        </div>
    </div>`;

    document.body.appendChild(modal);
}

async function vincularEscolaExistente() {
    const escolaId = document.getElementById('selectEscolaVinculo')?.value;
    if (!escolaId) { showToast('Selecione uma escola', 'error'); return; }
    mostrarLoading(true);
    try {
        await updateDoc(doc(db, 'usuarios', usuarioLogado.uid), { escolaId });
        perfilUsuario.escolaId = escolaId;
        await carregarEscola();
        atualizarBrandingEscola();
        atualizarInterface();
        fecharModalSelecionarEscola();
        showToast('Escola vinculada com sucesso! ✅', 'success');
    } catch(e) {
        showToast('Erro ao vincular: ' + e.message, 'error');
    } finally {
        mostrarLoading(false);
    }
}

function fecharModalSelecionarEscola() {
    document.getElementById('modalSelecionarEscola')?.remove();
}

async function abrirModalNovaEscolaEVincular() {
    _escolaEditandoId   = null;
    _logoEditandoBase64 = null;
    _paletaEditando     = PALETAS[0];
    renderModalEscolaComCallback(async (novoId) => {
        await updateDoc(doc(db, 'usuarios', usuarioLogado.uid), { escolaId: novoId });
        perfilUsuario.escolaId = novoId;
        await carregarEscola();
        atualizarBrandingEscola();
        atualizarInterface();
        fecharModalSelecionarEscola();
        showToast('Escola criada e vinculada! ✅', 'success');
    });
}

function setupEventListeners() {
    const inicioLetivo = document.getElementById('inicioLetivo');
    const btnHoje      = document.getElementById('btnHoje');
    const btnVoltar    = document.getElementById('voltar');

    inicioLetivo?.addEventListener('change', e => gerarSemanas(e.target.value));
    btnHoje?.addEventListener('click', () => {
        const hoje = new Date().toISOString().split('T')[0];
        document.getElementById('inicioLetivo').value = hoje;
        gerarSemanas(hoje);
    });
    btnVoltar?.addEventListener('click', () => {
        document.getElementById('paginaAulas').classList.add('hidden');
        document.getElementById('paginaSemanas').classList.remove('hidden');
    });
}

function atualizarInterface() {
    const el = document.getElementById('userCumprimento');
    if (el) el.textContent = (perfilUsuario?.nome || '').split(' ')[0] || 'Professor';

    // Avatar no botão de perfil da topbar
    const inicial = (perfilUsuario?.nome || perfilUsuario?.email || '?')[0].toUpperCase();
    const navAvatar = document.getElementById('navAvatarInicial');
    if (navAvatar) navAvatar.textContent = inicial;

    const btnAdmin = document.getElementById('btnAdmin');
    const isAdmin  = perfilUsuario?.tipo === 'admin' || perfilUsuario?.tipo === 'superadmin';
    if (btnAdmin) {
        if (isAdmin) btnAdmin.classList.remove('hidden');
        else         btnAdmin.classList.add('hidden');
    }
    atualizarStatusHorario();
}

function atualizarStatusHorario() {
    const el = document.getElementById('statusHorario');
    if (!el) return;
    let total = 0;
    Object.values(horarioProfessor).forEach(dia => {
        if (Array.isArray(dia)) dia.forEach(a => { if (a?.disciplina && a?.turma) total++; });
    });
    if (total === 0) {
        el.textContent = '⚠️ Configure seu horário primeiro';
        el.className   = 'status-badge status-warn';
    } else {
        el.textContent = `✅ Horário configurado — ${total} aulas/semana`;
        el.className   = 'status-badge status-ok';
    }
}

// ══════════════════════════════════════════════════════════
//  PERFIL DO USUÁRIO
// ══════════════════════════════════════════════════════════

function abrirPerfil() {
    document.getElementById('paginaInicio').classList.add('hidden');
    document.getElementById('paginaPerfil').classList.remove('hidden');
    carregarDadosPerfil();
}

function fecharPerfil() {
    document.getElementById('paginaPerfil').classList.add('hidden');
    document.getElementById('paginaInicio').classList.remove('hidden');
}

async function carregarDadosPerfil() {
    try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const docUsuario = await getDoc(doc(db, 'usuarios', uid));
        const dados = docUsuario.exists() ? docUsuario.data() : {};

        const nome  = dados.nome  || auth.currentUser.displayName || '';
        const email = auth.currentUser.email || dados.email || '';
        const tipo  = dados.tipo  || 'professor';

        // Sidebar de identidade
        document.getElementById('perfilNomeDisplay').textContent  = nome  || '(sem nome)';
        document.getElementById('perfilEmailDisplay').textContent = email || '—';
        document.getElementById('perfilTipoBadge').textContent    = _labelTipo(tipo);
        document.getElementById('perfilAvatarLetra').textContent  = (nome || email || '?')[0].toUpperCase();

        // Escola
        let nomeEscola = '—';
        if (dados.escolaId) {
            const docEscola = await getDoc(doc(db, 'escolas', dados.escolaId));
            if (docEscola.exists()) nomeEscola = docEscola.data().nome || '—';
        }
        document.getElementById('perfilEscolaChip').textContent = nomeEscola;
        document.getElementById('perfilEscola').value          = nomeEscola;

        // Campos editáveis
        document.getElementById('perfilNome').value      = nome;
        document.getElementById('perfilEmailInfo').value = email;

        // Disciplinas
        _perfilDisciplinas = Array.isArray(dados.disciplinas) ? [...dados.disciplinas] : [];
        _renderizarTagsDisciplinas();
        _renderizarSidebarDisc();

        // Limpa campos de senha
        ['perfilSenhaAtual', 'perfilNovaSenha', 'perfilConfirmarSenha'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        _resetForcaSenhaPerfil();

    } catch (err) {
        console.error('Erro ao carregar perfil:', err);
        showToast('Erro ao carregar perfil: ' + err.message, 'error');
    }
}

async function salvarDadosPerfil() {
    const btn  = document.getElementById('btnSalvarDados');
    const nome = document.getElementById('perfilNome').value.trim();

    if (!nome) {
        showToast('Por favor, informe seu nome.', 'error');
        document.getElementById('perfilNome').focus();
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = 'Salvando…';

        const uid = auth.currentUser.uid;
        await updateDoc(doc(db, 'usuarios', uid), { nome });
        await updateProfile(auth.currentUser, { displayName: nome });

        // Atualiza estado global
        if (perfilUsuario) perfilUsuario.nome = nome;

        // Atualiza UI
        document.getElementById('perfilNomeDisplay').textContent = nome;
        document.getElementById('perfilAvatarLetra').textContent = nome[0].toUpperCase();
        const navAvatar = document.getElementById('navAvatarInicial');
        if (navAvatar) navAvatar.textContent = nome[0].toUpperCase();
        const cumprimento = document.getElementById('userCumprimento');
        if (cumprimento) cumprimento.textContent = nome.split(' ')[0];

        showToast('Dados salvos com sucesso! ✅', 'success');
    } catch (err) {
        console.error('Erro ao salvar dados:', err);
        showToast('Erro ao salvar: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
            </svg>
            Salvar dados`;
    }
}

// ── Disciplinas ───────────────────────────────────────────
function adicionarDisciplina() {
    const input = document.getElementById('perfilDisciplinaInput');
    const valor = input.value.trim();
    if (!valor) return;

    if (_perfilDisciplinas.some(d => d.toLowerCase() === valor.toLowerCase())) {
        showToast('Essa disciplina já foi adicionada.', 'error');
        return;
    }

    _perfilDisciplinas.push(valor);
    input.value = '';
    input.focus();
    _renderizarTagsDisciplinas();
    _renderizarSidebarDisc();
}

function removerDisciplina(index) {
    _perfilDisciplinas.splice(index, 1);
    _renderizarTagsDisciplinas();
    _renderizarSidebarDisc();
}

function _renderizarTagsDisciplinas() {
    const container = document.getElementById('perfilDisciplinasTags');
    if (!container) return;
    container.innerHTML = '';

    if (_perfilDisciplinas.length === 0) {
        container.innerHTML = '<span class="perfil-tags-vazio">Nenhuma disciplina adicionada ainda.</span>';
        return;
    }

    _perfilDisciplinas.forEach((disciplina, i) => {
        const tag = document.createElement('span');
        tag.className = 'perfil-tag';
        tag.innerHTML = `
            ${_escaparHtml(disciplina)}
            <button class="perfil-tag-remover" onclick="removerDisciplina(${i})" aria-label="Remover ${_escaparHtml(disciplina)}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>`;
        container.appendChild(tag);
    });
}

function _renderizarSidebarDisc() {
    const container = document.getElementById('perfilSidebarDisc');
    if (!container) return;

    if (_perfilDisciplinas.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="sidebar-disc-titulo">Disciplinas</div>
        <div class="sidebar-disc-lista">
            ${_perfilDisciplinas.map(d => `<span class="sidebar-disc-item">${_escaparHtml(d)}</span>`).join('')}
        </div>`;
}

async function salvarDisciplinas() {
    try {
        const uid = auth.currentUser.uid;
        await updateDoc(doc(db, 'usuarios', uid), { disciplinas: _perfilDisciplinas });
        if (perfilUsuario) perfilUsuario.disciplinas = _perfilDisciplinas;
        showToast('Disciplinas salvas! ✅', 'success');
    } catch (err) {
        showToast('Erro ao salvar disciplinas: ' + err.message, 'error');
    }
}

// ── Segurança / Alterar senha ─────────────────────────────
async function alterarSenhaPerfil() {
    const btn          = document.getElementById('btnAlterarSenha');
    const senhaAtual   = document.getElementById('perfilSenhaAtual').value;
    const novaSenha    = document.getElementById('perfilNovaSenha').value;
    const confirmar    = document.getElementById('perfilConfirmarSenha').value;

    if (!senhaAtual || !novaSenha || !confirmar) {
        showToast('Preencha todos os campos de senha.', 'error'); return;
    }
    if (novaSenha.length < 6) {
        showToast('A nova senha deve ter no mínimo 6 caracteres.', 'error'); return;
    }
    if (novaSenha !== confirmar) {
        showToast('As senhas não conferem.', 'error');
        document.getElementById('perfilConfirmarSenha').focus();
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = 'Alterando…';

        const user       = auth.currentUser;
        const credencial = EmailAuthProvider.credential(user.email, senhaAtual);
        await reauthenticateWithCredential(user, credencial);
        await updatePassword(user, novaSenha);

        ['perfilSenhaAtual', 'perfilNovaSenha', 'perfilConfirmarSenha'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        _resetForcaSenhaPerfil();

        showToast('Senha alterada com sucesso! ✅', 'success');
    } catch (err) {
        console.error('Erro ao alterar senha:', err);
        const msg = err.code === 'auth/wrong-password'
            ? 'Senha atual incorreta.'
            : 'Erro ao alterar senha: ' + err.message;
        showToast(msg, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Alterar senha`;
    }
}

// ── Força da senha no perfil ──────────────────────────────
window.avaliarForcaSenhaPerfil = function(senha) {
    const barra = document.getElementById('perfilForcaBarra');
    const texto = document.getElementById('perfilForcaTexto');
    if (!barra || !texto) return;

    let pontos = 0;
    if (senha.length >= 6)  pontos++;
    if (senha.length >= 10) pontos++;
    if (/[A-Z]/.test(senha)) pontos++;
    if (/[0-9]/.test(senha)) pontos++;
    if (/[^A-Za-z0-9]/.test(senha)) pontos++;

    const niveis = [
        { label: '',           cor: 'transparent', pct: '0%'   },
        { label: 'Muito fraca',cor: '#ef4444',     pct: '20%'  },
        { label: 'Fraca',      cor: '#f97316',     pct: '40%'  },
        { label: 'Razoável',   cor: '#eab308',     pct: '60%'  },
        { label: 'Boa',        cor: '#22c55e',     pct: '80%'  },
        { label: 'Forte',      cor: '#16a34a',     pct: '100%' },
    ];

    const nivel = niveis[Math.min(pontos, 5)];
    barra.style.width      = senha ? nivel.pct : '0%';
    barra.style.background = nivel.cor;
    texto.textContent      = senha ? nivel.label : '';
};

function _resetForcaSenhaPerfil() {
    const barra = document.getElementById('perfilForcaBarra');
    const texto = document.getElementById('perfilForcaTexto');
    if (barra) { barra.style.width = '0%'; barra.style.background = 'transparent'; }
    if (texto) texto.textContent = '';
}

// ── Toggle senha no perfil ────────────────────────────────
window.toggleSenhaPerfil = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const mostrar = input.type === 'password';
    input.type    = mostrar ? 'text' : 'password';
    btn.style.opacity = mostrar ? '1' : '.5';
};

// ── Helpers ───────────────────────────────────────────────
function _labelTipo(tipo) {
    const mapa = { superadmin: 'Superadmin', admin: 'Administrador', professor: 'Professor' };
    return mapa[tipo] || 'Professor';
}

// ──────────────────────────────────────────────────────────
//  MODAL DE CONFIGURAÇÃO DO HORÁRIO
// ──────────────────────────────────────────────────────────
function abrirConfiguracaoHorario() {
    const conf = escolaAtual?.configHorario || {
        horaInicio: '07:15', duracaoAula: 45,
        numAulas: 7, duracaoRecreo: 15, posicaoRecreo: 3
    };

    const disciplinas = escolaAtual?.disciplinas || DISCIPLINAS_PADRAO;
    const turmas      = escolaAtual?.turmas      || TURMAS_PADRAO;

    const modal = document.createElement('div');
    modal.id = 'modalHorario';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
    <div class="modal-box">
        <div class="modal-header">
            <h3>🕐 Configurar Meu Horário Semanal</h3>
            <button class="modal-close" onclick="fecharModalHorario()">✕</button>
        </div>

        <div class="horario-config-grid">
            <div class="horario-field">
                <label>Hora de início</label>
                <input type="time" id="cfgHoraInicio" value="${conf.horaInicio}">
            </div>
            <div class="horario-field">
                <label>Duração de aula (min)</label>
                <input type="number" id="cfgDuracao" value="${conf.duracaoAula}" min="30" max="90" step="5">
            </div>
            <div class="horario-field">
                <label>Nº de aulas por dia</label>
                <input type="number" id="cfgNumAulas" value="${conf.numAulas}" min="1" max="12">
            </div>
            <div class="horario-field">
                <label>Duração do recreio (min)</label>
                <input type="number" id="cfgDuracaoRecreo" value="${conf.duracaoRecreo}" min="5" max="60" step="5">
            </div>
            <div class="horario-field">
                <label>Recreio após aula nº</label>
                <input type="number" id="cfgPosicaoRecreo" value="${conf.posicaoRecreo}" min="1" max="12">
            </div>
            <div class="horario-field" style="display:flex;align-items:flex-end;">
                <button class="btn-ghost" style="width:100%" onclick="atualizarGradeHorario()">🔄 Atualizar grade</button>
            </div>
        </div>

        <div class="grade-horario-wrap">
            <div id="gradeHorario" class="grade-horario"></div>
        </div>

        <div class="modal-footer">
            <button class="btn-cancel" onclick="fecharModalHorario()">Cancelar</button>
            <button class="btn-save" onclick="salvarHorario()">💾 Salvar Horário</button>
        </div>
    </div>`;

    document.body.appendChild(modal);
    renderGradeHorario();
}

function lerConfigHorario() {
    return {
        horaInicio:    document.getElementById('cfgHoraInicio')?.value     || '07:15',
        duracaoAula:   parseInt(document.getElementById('cfgDuracao')?.value      || 45),
        numAulas:      parseInt(document.getElementById('cfgNumAulas')?.value     || 7),
        duracaoRecreo: parseInt(document.getElementById('cfgDuracaoRecreo')?.value || 15),
        posicaoRecreo: parseInt(document.getElementById('cfgPosicaoRecreo')?.value || 3),
    };
}

function atualizarGradeHorario() { renderGradeHorario(); }

function renderGradeHorario() {
    const container = document.getElementById('gradeHorario');
    if (!container) return;

    const cfg = lerConfigHorario();
    const { horarios, breaks } = calcularHorarios(cfg);
    const disciplinas = escolaAtual?.disciplinas || DISCIPLINAS_PADRAO;
    const turmas      = escolaAtual?.turmas      || TURMAS_PADRAO;
    const ncols       = 6;

    container.style.gridTemplateColumns = `90px repeat(5, 1fr)`;

    let html = `<div class="gh-head">Horário</div>`;
    DIAS_SEMANA.forEach(d => { html += `<div class="gh-head">${d}</div>`; });

    horarios.forEach((hor, i) => {
        if (breaks[i]) {
            html += `<div class="gh-break" style="grid-column: span ${ncols};">☕ ${hor}</div>`;
        } else {
            const aulaIdx = horarios.slice(0, i+1).filter((_,j) => !breaks[j]).length - 1;
            html += `<div class="gh-time">${hor}</div>`;
            DIAS_SEMANA.forEach(dia => {
                const aulaData = (horarioProfessor[dia] && horarioProfessor[dia][aulaIdx]) || {};
                html += `
                <div class="gh-cell">
                    <select onchange="atualizarDisciplinaHorario('${dia}',${aulaIdx},this.value)">
                        <option value="">— sem aula —</option>
                        ${disciplinas.map(d =>
                            `<option value="${d.id}" ${aulaData.disciplina===d.id?'selected':''}>${d.icone} ${d.nome}</option>`
                        ).join('')}
                    </select>
                    ${aulaData.disciplina ? `
                    <select onchange="atualizarTurmaHorario('${dia}',${aulaIdx},this.value)">
                        <option value="">Turma...</option>
                        ${turmas.map(t => `<option value="${t}" ${aulaData.turma===t?'selected':''}>Turma ${t}</option>`).join('')}
                    </select>` : ''}
                </div>`;
            });
        }
    });

    container.innerHTML = html;
}

function atualizarDisciplinaHorario(dia, idx, disc) {
    if (!horarioProfessor[dia]) horarioProfessor[dia] = [];
    if (!horarioProfessor[dia][idx]) horarioProfessor[dia][idx] = {};
    horarioProfessor[dia][idx].disciplina = disc;
    horarioProfessor[dia][idx].turma = '';
    renderGradeHorario();
}

function atualizarTurmaHorario(dia, idx, turma) {
    if (!horarioProfessor[dia]) horarioProfessor[dia] = [];
    if (!horarioProfessor[dia][idx]) horarioProfessor[dia][idx] = {};
    horarioProfessor[dia][idx].turma = turma;
}

async function salvarHorario() {
    const cfg = lerConfigHorario();
    mostrarLoading(true);
    try {
        await salvarHorarioFirestore();
        if ((perfilUsuario?.tipo === 'admin' || perfilUsuario?.tipo === 'superadmin') && perfilUsuario?.escolaId) {
            await updateDoc(doc(db, 'escolas', perfilUsuario.escolaId), { configHorario: cfg });
            if (escolaAtual) escolaAtual.configHorario = cfg;
        }
        showToast('Horário salvo! ✅', 'success');
        fecharModalHorario();
        atualizarStatusHorario();
        if (semanas.length > 0) { aplicarHorarioNasSemanas(); renderSemanas(); }
    } catch(e) {
        showToast('Erro ao salvar: ' + e.message, 'error');
    } finally {
        mostrarLoading(false);
    }
}

function aplicarHorarioNasSemanas() {
    semanas.forEach((_, i) => {
        const chave = `semana_${i}`;
        if (planejamentos[chave]) {
            const nova   = criarGradeBaseadaNoHorario();
            const antiga = planejamentos[chave].aulas;
            for (let d = 0; d < 5; d++)
                for (let a = 0; a < nova[d].length; a++)
                    if (antiga[d]?.[a]?.conteudo) nova[d][a].conteudo = antiga[d][a].conteudo;
            planejamentos[chave].aulas = nova;
        }
    });
    salvarPlanejamentosDebounce();
}

function fecharModalHorario() {
    document.getElementById('modalHorario')?.remove();
}

// ──────────────────────────────────────────────────────────
//  PAINEL DE ADMINISTRAÇÃO
// ──────────────────────────────────────────────────────────
async function abrirPainelAdmin() {
    const tipo = perfilUsuario?.tipo;
    if (tipo !== 'admin' && tipo !== 'superadmin') {
        showToast('Acesso restrito', 'error'); return;
    }
    mostrarLoading(true);
    let escolas = [], usuarios = [];
    try {
        const [esnap, usnap] = await Promise.all([
            getDocs(collection(db, 'escolas')),
            getDocs(collection(db, 'usuarios'))
        ]);
        esnap.forEach(d => escolas.push({ id: d.id, ...d.data() }));
        usnap.forEach(d => usuarios.push({ uid: d.id, ...d.data() }));
    } catch(e) { showToast('Erro ao carregar dados: ' + e.message, 'error'); }
    mostrarLoading(false);

    const isSuperAdmin = tipo === 'superadmin';
    const escolasFiltradas   = isSuperAdmin ? escolas   : escolas.filter(e => e.id === perfilUsuario.escolaId);
    const usuariosFiltrados  = isSuperAdmin ? usuarios  : usuarios.filter(u => u.escolaId === perfilUsuario.escolaId);

    const modal = document.createElement('div');
    modal.id = 'modalAdmin';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
    <div class="modal-box">
        <div class="modal-header">
            <h3>⚙️ Administração</h3>
            <button class="modal-close" onclick="fecharModalAdmin()">✕</button>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
            ${isSuperAdmin ? `<button class="btn-outline" onclick="abrirModalNovaEscola()">+ Nova Escola</button>` : ''}
            <button class="btn-outline" onclick="abrirModalConvidarProfessor()">+ Convidar Professor</button>
        </div>

        <div style="margin-bottom:24px;">
            <h4 style="font-family:var(--font-display);font-size:18px;color:var(--primary);margin-bottom:14px;">🏫 Escolas</h4>
            ${escolasFiltradas.length === 0 ? '<p style="color:var(--text-muted)">Nenhuma escola cadastrada.</p>' :
            escolasFiltradas.map(e => `
                <div class="escola-card">
                    ${e.logoBase64
                        ? `<img class="escola-logo-thumb" src="${e.logoBase64}" alt="${e.nome}">`
                        : `<div class="escola-logo-emoji">🏫</div>`}
                    <div class="escola-info">
                        <h4>${e.nome}</h4>
                        <small>${e.cidade || ''} ${e.cidade && e.estado ? '·' : ''} ${e.estado || ''}</small>
                    </div>
                    <div class="escola-palette">
                        <div class="palette-dot" style="background:${e.paleta?.primary || '#0047B6'}"></div>
                        <div class="palette-dot" style="background:${e.paleta?.accent  || '#F2B817'}"></div>
                    </div>
                    <button class="btn-sm" onclick="abrirModalEditarEscola('${e.id}')">✏️ Editar</button>
                </div>
            `).join('')}
        </div>

        <div>
            <h4 style="font-family:var(--font-display);font-size:18px;color:var(--primary);margin-bottom:14px;">👥 Professores (${usuariosFiltrados.filter(u=>u.tipo==='professor').length})</h4>
            <div style="max-height:250px;overflow-y:auto;">
            ${usuariosFiltrados.filter(u=>u.tipo!=='superadmin').map(u => `
                <div class="user-item">
                    <strong>${u.nome}</strong>
                    <small>${u.email} · ${u.tipo} · desde ${u.dataCadastro ? new Date(u.dataCadastro).toLocaleDateString('pt-BR') : '—'}</small>
                </div>
            `).join('') || '<p style="color:var(--text-muted)">Nenhum professor.</p>'}
            </div>
        </div>

        <div class="modal-footer">
            <button class="btn-cancel" onclick="fecharModalAdmin()">Fechar</button>
        </div>
    </div>`;

    document.body.appendChild(modal);
}

function fecharModalAdmin() {
    document.getElementById('modalAdmin')?.remove();
}

// ──────────────────────────────────────────────────────────
//  MODAL — NOVA ESCOLA / EDITAR ESCOLA
// ──────────────────────────────────────────────────────────
let _escolaEditandoId   = null;
let _logoEditandoBase64 = null;
let _paletaEditando     = null;

async function abrirModalNovaEscola() {
    _escolaEditandoId   = null;
    _logoEditandoBase64 = null;
    _paletaEditando     = PALETAS[0];
    renderModalEscola(null);
}

async function abrirModalEditarEscola(escolaId) {
    mostrarLoading(true);
    const snap = await getDoc(doc(db, 'escolas', escolaId));
    mostrarLoading(false);
    if (!snap.exists()) { showToast('Escola não encontrada', 'error'); return; }
    _escolaEditandoId   = escolaId;
    _logoEditandoBase64 = snap.data().logoBase64 || null;
    _paletaEditando     = snap.data().paleta || PALETAS[0];
    renderModalEscola(snap.data());
}

let _onEscolaSalvaCallback = null;

function renderModalEscolaComCallback(callback) {
    _onEscolaSalvaCallback = callback;
    renderModalEscola(null);
}

function renderModalEscola(dados) {
    document.getElementById('modalAdmin')?.remove();

    const isNova = !dados;
    const modal  = document.createElement('div');
    modal.id = 'modalEscola';
    modal.className = 'modal-backdrop';

    const palAtual = _paletaEditando || PALETAS[0];

    modal.innerHTML = `
    <div class="modal-box">
        <div class="modal-header">
            <h3>${isNova ? '+ Nova Escola' : '✏️ Editar Escola'}</h3>
            <button class="modal-close" onclick="fecharModalEscola()">✕</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
            <div class="horario-field">
                <label>Nome da escola *</label>
                <input type="text" id="escolaNome" value="${dados?.nome||''}" placeholder="Ex: CEFET Rio de Janeiro">
            </div>
            <div class="horario-field">
                <label>Cidade</label>
                <input type="text" id="escolaCidade" value="${dados?.cidade||''}" placeholder="Rio de Janeiro">
            </div>
            <div class="horario-field">
                <label>Estado</label>
                <input type="text" id="escolaEstado" value="${dados?.estado||''}" placeholder="RJ">
            </div>
            <div class="horario-field">
                <label>Turmas (separadas por vírgula)</label>
                <input type="text" id="escolaTurmas" value="${(dados?.turmas || TURMAS_PADRAO).join(', ')}" placeholder="101, 102, 201...">
            </div>
        </div>

        <div style="margin-bottom:24px;">
            <div class="horario-field" style="margin-bottom:12px;">
                <label>Logotipo da escola</label>
            </div>
            <div class="dropzone" id="dropzoneLogo">
                <input type="file" accept="image/*" onchange="handleLogoFile(this.files[0])">
                ${_logoEditandoBase64
                    ? `<img src="${_logoEditandoBase64}" class="logo-preview" id="logoPreview" alt="Logo">`
                    : `<div>
                         <div class="dropzone-icon">🖼️</div>
                         <div class="dropzone-text">Arraste o logo aqui ou clique para selecionar</div>
                         <div class="dropzone-sub">PNG, JPG ou SVG — máx. 2 MB</div>
                       </div>`}
            </div>
            ${_logoEditandoBase64 ? `<button class="btn-sm" style="margin-top:8px" onclick="removerLogo()">🗑️ Remover logo</button>` : ''}
        </div>

        <div style="margin-bottom:24px;">
            <div class="horario-field" style="margin-bottom:12px;">
                <label>Paleta de cores</label>
            </div>
            <div class="palette-picker" id="palettePicker">
                ${PALETAS.filter(p=>p.id!=='custom').map(p => `
                <div class="palette-option ${palAtual?.id===p.id?'selected':''}" onclick="selecionarPaleta('${p.id}')">
                    <div class="palette-swatches">
                        <div class="palette-swatch" style="background:${p.primary}"></div>
                        <div class="palette-swatch" style="background:${p.accent}"></div>
                    </div>
                    <div class="palette-label">${p.nome}</div>
                </div>`).join('')}
                <div class="palette-option ${palAtual?.id==='custom'?'selected':''}" onclick="selecionarPaleta('custom')">
                    <div class="palette-swatches">
                        <div class="palette-swatch" style="background:${palAtual?.id==='custom'?palAtual.primary:'#999'}"></div>
                        <div class="palette-swatch" style="background:${palAtual?.id==='custom'?palAtual.accent:'#ccc'}"></div>
                    </div>
                    <div class="palette-label">Personalizado</div>
                </div>
            </div>

            <div id="customColorPickers" class="${palAtual?.id==='custom'?'':'hidden'}" style="margin-top:14px;">
                <div class="color-pickers-row">
                    <div class="color-pick-item">
                        <label>Cor principal</label>
                        <input type="color" id="cpPrimary" value="${palAtual?.primary||'#0047B6'}" oninput="atualizarCustomPaleta()">
                    </div>
                    <div class="color-pick-item">
                        <label>Cor escura</label>
                        <input type="color" id="cpPrimaryDark" value="${palAtual?.primaryDark||'#003490'}" oninput="atualizarCustomPaleta()">
                    </div>
                    <div class="color-pick-item">
                        <label>Destaque</label>
                        <input type="color" id="cpAccent" value="${palAtual?.accent||'#F2B817'}" oninput="atualizarCustomPaleta()">
                    </div>
                </div>
            </div>
        </div>

        <div class="modal-footer">
            <button class="btn-cancel" onclick="fecharModalEscola(); abrirPainelAdmin();">Cancelar</button>
            <button class="btn-save" onclick="salvarEscola()">💾 Salvar Escola</button>
        </div>
    </div>`;

    document.body.appendChild(modal);
    setupDropzone();
}

function setupDropzone() {
    const dz = document.getElementById('dropzoneLogo');
    if (!dz) return;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleLogoFile(file);
    });
}

window.handleLogoFile = function(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Imagem muito grande. Máx. 2 MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        _logoEditandoBase64 = e.target.result;
        const dz = document.getElementById('dropzoneLogo');
        if (dz) {
            const input = dz.querySelector('input');
            dz.innerHTML = `<img src="${_logoEditandoBase64}" class="logo-preview" id="logoPreview" alt="Logo">`;
            if (input) dz.appendChild(input);
        }
        showToast('Logo carregado! ✅', 'success');
    };
    reader.readAsDataURL(file);
};

window.removerLogo = function() {
    _logoEditandoBase64 = null;
    const dz = document.getElementById('dropzoneLogo');
    if (dz) {
        dz.innerHTML = `
        <input type="file" accept="image/*" onchange="handleLogoFile(this.files[0])">
        <div class="dropzone-icon">🖼️</div>
        <div class="dropzone-text">Arraste o logo aqui ou clique para selecionar</div>
        <div class="dropzone-sub">PNG, JPG ou SVG — máx. 2 MB</div>`;
        setupDropzone();
    }
};

window.selecionarPaleta = function(id) {
    document.querySelectorAll('.palette-option').forEach(el => el.classList.remove('selected'));
    const sel = [...document.querySelectorAll('.palette-option')].find(el =>
        el.onclick?.toString().includes(`'${id}'`)
    );
    if (sel) sel.classList.add('selected');

    if (id === 'custom') {
        document.getElementById('customColorPickers')?.classList.remove('hidden');
        atualizarCustomPaleta();
    } else {
        document.getElementById('customColorPickers')?.classList.add('hidden');
        const p = PALETAS.find(x => x.id === id);
        if (p) { _paletaEditando = { ...p }; aplicarTema(p); }
    }
};

window.atualizarCustomPaleta = function() {
    const primary     = document.getElementById('cpPrimary')?.value     || '#0047B6';
    const primaryDark = document.getElementById('cpPrimaryDark')?.value  || '#003490';
    const accent      = document.getElementById('cpAccent')?.value       || '#F2B817';
    _paletaEditando = { id: 'custom', nome: 'Personalizado', primary, primaryDark, accent };
    aplicarTema(_paletaEditando);
};

async function salvarEscola() {
    const nome      = document.getElementById('escolaNome')?.value.trim();
    const cidade    = document.getElementById('escolaCidade')?.value.trim();
    const estado    = document.getElementById('escolaEstado')?.value.trim();
    const turmasRaw = document.getElementById('escolaTurmas')?.value || '';
    const turmas    = turmasRaw.split(',').map(t => t.trim()).filter(Boolean);

    if (!nome) { showToast('Informe o nome da escola', 'error'); return; }

    mostrarLoading(true);
    try {
        const dados = {
            nome, cidade, estado, turmas,
            paleta:      _paletaEditando || PALETAS[0],
            logoBase64:  _logoEditandoBase64 || null,
            disciplinas: DISCIPLINAS_PADRAO,
            updatedAt:   new Date().toISOString()
        };
        if (_escolaEditandoId) {
            await updateDoc(doc(db, 'escolas', _escolaEditandoId), dados);
            showToast('Escola atualizada! ✅', 'success');
            fecharModalEscola();
            await carregarEscola();
            atualizarBrandingEscola();
            if (_onEscolaSalvaCallback) { await _onEscolaSalvaCallback(_escolaEditandoId); _onEscolaSalvaCallback = null; }
            else abrirPainelAdmin();
        } else {
            const novoId = Date.now().toString();
            await setDoc(doc(db, 'escolas', novoId), { ...dados, criadoEm: new Date().toISOString() });
            showToast('Escola criada! ✅', 'success');
            fecharModalEscola();
            await carregarEscola();
            atualizarBrandingEscola();
            if (_onEscolaSalvaCallback) { await _onEscolaSalvaCallback(novoId); _onEscolaSalvaCallback = null; }
            else abrirPainelAdmin();
        }
    } catch(e) {
        showToast('Erro: ' + e.message, 'error');
    } finally {
        mostrarLoading(false);
    }
}

function fecharModalEscola() {
    document.getElementById('modalEscola')?.remove();
}

function abrirModalConvidarProfessor() {
    const modal = document.createElement('div');
    modal.id = 'modalConvite';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
    <div class="modal-box modal-sm">
        <div class="modal-header">
            <h3>📨 Convidar Professor</h3>
            <button class="modal-close" onclick="document.getElementById('modalConvite').remove()">✕</button>
        </div>
        <p style="color:var(--text-muted);margin-bottom:16px;line-height:1.7;">
            Para convidar um professor, compartilhe o link do sistema e peça que ele crie uma conta
            selecionando <strong>${escolaAtual?.nome || 'sua escola'}</strong> no campo de escola durante o cadastro.
        </p>
        <div style="background:var(--primary-light);border-radius:8px;padding:14px;font-size:13px;font-weight:600;color:var(--primary);word-break:break-all;">
            ${window.location.href}
        </div>
        <div class="modal-footer">
            <button class="btn-outline" onclick="navigator.clipboard.writeText('${window.location.href}');showToast('Link copiado!','success')">📋 Copiar link</button>
            <button class="btn-cancel" onclick="document.getElementById('modalConvite').remove()">Fechar</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

// ──────────────────────────────────────────────────────────
//  SEMANAS LETIVAS
// ──────────────────────────────────────────────────────────
async function gerarSemanas(dataISO) {
    if (!dataISO) return;
    if (Object.keys(horarioProfessor).length === 0) {
        showToast('Configure seu horário primeiro!', 'error');
        abrirConfiguracaoHorario();
        return;
    }
    semanas = [];
    const data = new Date(dataISO + 'T12:00:00');
    const dow  = data.getDay();
    if (dow !== 1) {
        data.setDate(data.getDate() + (dow === 0 ? 1 : 2 - dow));
    }
    for (let i = 0; i < 43; i++) {
        const inicio = new Date(data);
        const fim    = new Date(data); fim.setDate(fim.getDate() + 4);
        semanas.push({ id: i + 1, inicio, fim });
        data.setDate(data.getDate() + 7);
    }
    await salvarDataInicioLetivo(dataISO);
    inicializarPlanejamentos();
    renderSemanas();
}

function inicializarPlanejamentos() {
    semanas.forEach((_, i) => {
        const chave = `semana_${i}`;
        if (!planejamentos[chave])
            planejamentos[chave] = { aulas: criarGradeBaseadaNoHorario() };
    });
    salvarPlanejamentosDebounce();
}

function criarGradeBaseadaNoHorario() {
    const cfg = escolaAtual?.configHorario || { numAulas: 7 };
    const n   = parseInt(cfg.numAulas || 7);
    const grade = Array.from({ length: 5 }, () =>
        Array.from({ length: n }, () => ({ disciplina: null, turma: null, conteudo: '' }))
    );
    DIAS_SEMANA.forEach((dia, di) => {
        (horarioProfessor[dia] || []).forEach((a, ai) => {
            if (a?.disciplina && a?.turma && ai < n) {
                grade[di][ai] = { disciplina: a.disciplina, turma: a.turma, conteudo: '' };
            }
        });
    });
    return grade;
}

function renderSemanas() {
    const container = document.getElementById('listaSemanas');
    if (!container) return;
    container.innerHTML = '';
    const hoje = new Date();
    semanas.forEach((semana, i) => {
        const ehAtual = hoje >= semana.inicio && hoje <= semana.fim;
        const div = document.createElement('div');
        div.className = 'semana-card' + (ehAtual ? ' atual' : '');
        div.onclick = () => abrirSemana(i);
        div.innerHTML = `
            <h3>Semana ${semana.id} ${ehAtual ? '📍' : ''}</h3>
            <p>${semana.inicio.toLocaleDateString('pt-BR')} a ${semana.fim.toLocaleDateString('pt-BR')}</p>`;
        container.appendChild(div);
    });
    const cnt = document.getElementById('contadorSemanas');
    if (cnt) cnt.textContent = `${semanas.length} semanas`;
}

function abrirSemana(index) {
    semanaAtual = index;
    const semana = semanas[index];
    document.getElementById('paginaSemanas').classList.add('hidden');
    document.getElementById('paginaAulas').classList.remove('hidden');
    const titulo = document.getElementById('tituloSemana');
    if (titulo) titulo.textContent = `Semana ${semana.id} — ${semana.inicio.toLocaleDateString('pt-BR')} a ${semana.fim.toLocaleDateString('pt-BR')}`;
    renderGradeSemana(index);
}

function renderGradeSemana(index) {
    const container = document.getElementById('gradeSemana');
    if (!container) return;

    const semana = semanas[index];
    const chave  = `semana_${index}`;
    const plan   = planejamentos[chave] || { aulas: criarGradeBaseadaNoHorario() };
    const cfg    = escolaAtual?.configHorario || { horaInicio:'07:15', duracaoAula:45, numAulas:7, duracaoRecreo:15, posicaoRecreo:3 };
    const { horarios, breaks } = calcularHorarios(cfg);
    const disciplinas = escolaAtual?.disciplinas || DISCIPLINAS_PADRAO;

    let html = `<div class="grade-wrapper"><div class="grade-table" style="grid-template-columns:110px repeat(5,1fr);">`;

    html += `<div class="grade-head-cell">Horário</div>`;
    DIAS_COMPLETO.forEach((dia, i) => {
        const data = new Date(semana.inicio); data.setDate(data.getDate() + i);
        html += `<div class="grade-head-cell">${dia}<br><small style="font-weight:400;opacity:.75">${data.toLocaleDateString('pt-BR')}</small></div>`;
    });

    let aulaIdx = 0;
    horarios.forEach((hor, i) => {
        if (breaks[i]) {
            html += `<div class="grade-break-cell" style="grid-column:span 6;">☕ ${hor}</div>`;
        } else {
            const ai = aulaIdx++;
            html += `<div class="grade-time-cell"><strong>${hor}</strong><small style="color:var(--text-muted)">${cfg.duracaoAula} min</small></div>`;
            for (let dia = 0; dia < 5; dia++) {
                const aulaData = plan.aulas[dia]?.[ai] || {};
                const temAula  = aulaData.disciplina && aulaData.turma;
                const disc     = disciplinas.find(d => d.id === aulaData.disciplina);
                if (temAula) {
                    html += `
                    <div class="grade-cell has-aula">
                        <div class="cell-disc-name">${disc?.icone || ''} ${disc?.nome || ''}</div>
                        <div class="cell-turma">🏫 Turma ${aulaData.turma}</div>
                        <textarea class="cell-textarea" placeholder="Conteúdo da aula..."
                            oninput="salvarConteudoAula(${index},${dia},${ai},this.value)"
                        >${aulaData.conteudo || ''}</textarea>
                        <div class="cell-btns">
                            <button class="cell-btn cell-btn-copy" onclick="copiarConteudo(${index},${dia},${ai})">📋 Copiar</button>
                            <button class="cell-btn cell-btn-del" onclick="apagarConteudoAula(${index},${dia},${ai})">🗑️</button>
                        </div>
                    </div>`;
                } else {
                    html += `<div class="grade-cell no-aula"><span>—</span></div>`;
                }
            }
        }
    });

    html += '</div></div>';
    container.innerHTML = html;
}

// ──────────────────────────────────────────────────────────
//  PLANEJAMENTO — SALVAR / COPIAR / APAGAR
// ──────────────────────────────────────────────────────────
function salvarConteudoAula(semanaIndex, diaIndex, aulaIndex, conteudo) {
    const chave = `semana_${semanaIndex}`;
    if (!planejamentos[chave]) planejamentos[chave] = { aulas: criarGradeBaseadaNoHorario() };
    if (!planejamentos[chave].aulas[diaIndex]) planejamentos[chave].aulas[diaIndex] = [];
    if (!planejamentos[chave].aulas[diaIndex][aulaIndex]) planejamentos[chave].aulas[diaIndex][aulaIndex] = {};
    planejamentos[chave].aulas[diaIndex][aulaIndex].conteudo = conteudo;
    salvarPlanejamentosDebounce();
}

function copiarConteudo(semanaIndex, diaIndex, aulaIndex) {
    const c = planejamentos[`semana_${semanaIndex}`]?.aulas[diaIndex]?.[aulaIndex]?.conteudo || '';
    if (!c) { showToast('Nenhum conteúdo para copiar', 'error'); return; }
    navigator.clipboard.writeText(c).then(() => showToast('Copiado! ✅', 'success'));
}

function apagarConteudoAula(semanaIndex, diaIndex, aulaIndex) {
    if (!confirm('Apagar o conteúdo desta aula?')) return;
    const chave = `semana_${semanaIndex}`;
    if (planejamentos[chave]?.aulas[diaIndex]?.[aulaIndex])
        planejamentos[chave].aulas[diaIndex][aulaIndex].conteudo = '';
    salvarPlanejamentosDebounce();
    renderGradeSemana(semanaIndex);
}

function apagarTodaSemana() {
    if (!confirm('Apagar TODO o conteúdo desta semana?')) return;
    const chave = `semana_${semanaAtual}`;
    if (planejamentos[chave]) planejamentos[chave].aulas = criarGradeBaseadaNoHorario();
    salvarPlanejamentosDebounce();
    renderGradeSemana(semanaAtual);
    showToast('Semana limpa!', 'success');
}

// ──────────────────────────────────────────────────────────
//  EXPORTAR DOC
// ──────────────────────────────────────────────────────────
function gerarHTMLDoc(titulo, semanasParaExportar) {
    const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#0047B6';
    const disciplinas = escolaAtual?.disciplinas || DISCIPLINAS_PADRAO;
    const cfg = escolaAtual?.configHorario || {};
    const { horarios, breaks } = calcularHorarios(cfg);
    const aulaHorarios = horarios.filter((_,i) => !breaks[i]);

    let html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
    <head><meta charset="UTF-8"><title>${titulo}</title>
    <style>
        body { font-family: Arial, sans-serif; font-size: 11px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
        th { background: ${primary}; color: white; padding: 8px; text-align: center; font-size: 11px; }
        td { border: 1px solid #ccc; padding: 6px; vertical-align: top; min-width: 80px; }
        .hcol { background: #e8f0fe; font-weight: bold; text-align: center; width: 90px; }
        h2 { color: ${primary}; margin: 20px 0 5px 0; }
        @page { size: A4 landscape; margin: 1cm; }
    </style></head><body>
    <h1 style="color:${primary};text-align:center;">📚 Planejamento de Aulas</h1>
    <p style="text-align:center;color:#666;">Prof. ${perfilUsuario?.nome||''} — ${escolaAtual?.nome||''} — ${new Date().toLocaleDateString('pt-BR')}</p>`;

    semanasParaExportar.forEach(semana => {
        const realIndex = semanas.findIndex(s => s.id === semana.id);
        const plan = planejamentos[`semana_${realIndex}`];
        if (!plan) return;

        html += `<h2>Semana ${semana.id} — ${semana.inicio.toLocaleDateString('pt-BR')} a ${semana.fim.toLocaleDateString('pt-BR')}</h2>
        <table><tr><th>Horário</th>`;
        DIAS_COMPLETO.forEach((dia, i) => {
            const d = new Date(semana.inicio); d.setDate(d.getDate() + i);
            html += `<th>${dia}<br><small>${d.toLocaleDateString('pt-BR')}</small></th>`;
        });
        html += '</tr>';

        aulaHorarios.forEach((hor, ai) => {
            html += `<tr><td class="hcol">${hor}</td>`;
            for (let di = 0; di < 5; di++) {
                const a    = plan.aulas[di]?.[ai];
                const disc = disciplinas.find(d => d.id === a?.disciplina);
                if (disc && a?.turma) {
                    html += `<td><strong>${disc.icone} ${disc.nome}</strong><br>
                        <span style="color:${primary};font-size:10px;">Turma ${a.turma}</span><br>
                        ${(a.conteudo||'').replace(/\n/g,'<br>')}</td>`;
                } else {
                    html += `<td style="background:#f9f9f9"></td>`;
                }
            }
            html += '</tr>';
        });
        html += '</table>';
    });

    html += '</body></html>';
    return html;
}

function baixarDoc(html, filename) {
    const blob = new Blob([html], { type: 'application/msword' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

function exportarSemanaDOC() {
    if (semanaAtual < 0) { showToast('Nenhuma semana selecionada', 'error'); return; }
    baixarDoc(gerarHTMLDoc(`Semana ${semanas[semanaAtual].id}`, [semanas[semanaAtual]]),
        `planejamento_semana_${semanas[semanaAtual].id}.doc`);
    showToast('DOC exportado! ✅', 'success');
}

function exportarParaDOC() {
    if (!semanas.length) { showToast('Gere as semanas primeiro', 'error'); return; }
    baixarDoc(gerarHTMLDoc('Planejamento Completo', semanas),
        `planejamento_completo_${new Date().toISOString().split('T')[0]}.doc`);
    showToast('DOC completo exportado! ✅', 'success');
}

// ──────────────────────────────────────────────────────────
//  EXPOR GLOBALMENTE
// ──────────────────────────────────────────────────────────
Object.assign(window, {
    // Auth
    fazerLogin, fazerCadastro, fazerLogout,
    iniciarRecuperacao, mostrarLogin, mostrarCadastro, mostrarRecuperacao,
    // Horário
    abrirConfiguracaoHorario, fecharModalHorario, salvarHorario,
    atualizarDisciplinaHorario, atualizarTurmaHorario, atualizarGradeHorario,
    // Admin
    abrirPainelAdmin, fecharModalAdmin,
    abrirModalNovaEscola, abrirModalEditarEscola, fecharModalEscola, salvarEscola,
    abrirModalConvidarProfessor,
    vincularEscolaExistente, fecharModalSelecionarEscola,
    // Planejamento
    salvarConteudoAula, copiarConteudo, apagarConteudoAula, apagarTodaSemana,
    exportarSemanaDOC, exportarParaDOC,
    // Perfil
    abrirPerfil, fecharPerfil,
    salvarDadosPerfil, salvarDisciplinas, alterarSenhaPerfil,
    adicionarDisciplina, removerDisciplina,
    // Utilitários
    showToast
});
