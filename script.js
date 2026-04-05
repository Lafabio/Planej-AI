 // ================================================================
//  EDUPLAN script.js — PATCH v3: Configuração IA pelo Admin
//  Instruções: substitua os trechos marcados no seu script.js
// ================================================================

// ────────────────────────────────────────────────────────────────
//  [1] SUBSTITUA o bloco "GEMINI AI — Configuração" existente
//      (as linhas com GEMINI_API_KEY e GEMINI_MODELS)
//      pelo bloco abaixo:
// ────────────────────────────────────────────────────────────────

/*
 *  🤖 GEMINI AI — Configuração dinâmica
 *  A chave é carregada do Firestore (configurável pelo Admin)
 *  Coleção: configuracoes_sistema / doc: ia
 *  Campos:  { geminiKey: string, modelo: string, ativo: bool }
 */
let GEMINI_API_KEY = "";           // preenchida em carregarConfiguracaoIA()
let GEMINI_MODELO_PREFERIDO = "";  // se vazio, usa a cascade abaixo

const GEMINI_MODELS = [
    "gemini-2.0-flash-lite",   // 1º: mais rápido, free tier generoso
    "gemini-2.0-flash",        // 2º: melhor qualidade, ainda gratuito
    "gemini-1.5-flash"         // 3º: fallback estável
];

// Carrega config de IA do Firestore (chamado junto com carregarDados)
async function carregarConfiguracaoIA() {
    try {
        const snap = await getDoc(doc(db, "configuracoes_sistema", "ia"));
        if (snap.exists()) {
            const cfg = snap.data();
            GEMINI_API_KEY        = cfg.geminiKey  || "";
            GEMINI_MODELO_PREFERIDO = cfg.modelo   || "";
        }
    } catch(e) {
        console.warn("[IA] Não foi possível carregar config de IA:", e.message);
    }
}

// chamarGemini — usa modelo preferido se configurado, senão cascade
async function chamarGemini(prompt) {
    if (!GEMINI_API_KEY) {
        throw new Error("Chave da API Gemini não configurada. Acesse Admin → Configurar IA.");
    }

    // Se admin fixou um modelo, tenta ele primeiro; senão usa a lista completa
    const modelos = GEMINI_MODELO_PREFERIDO
        ? [GEMINI_MODELO_PREFERIDO, ...GEMINI_MODELS.filter(m => m !== GEMINI_MODELO_PREFERIDO)]
        : GEMINI_MODELS;

    let ultimoErro = null;

    for (const modelo of modelos) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
            const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 512,
                        topK: 40,
                        topP: 0.95
                    },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
                        { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
                    ]
                })
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                if (resp.status === 429 || resp.status === 503) {
                    ultimoErro = new Error(`${modelo}: ${err?.error?.message || resp.statusText}`);
                    console.warn(`[Gemini] ${modelo} indisponível, tentando próximo...`);
                    continue;
                }
                throw new Error(err?.error?.message || `HTTP ${resp.status}`);
            }

            const data = await resp.json();
            const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error("Resposta vazia do modelo");

            console.log(`[Gemini] ✅ Sucesso com: ${modelo}`);
            return texto.trim();

        } catch(e) {
            if (e.message.includes("quota") || e.message.includes("429")) {
                ultimoErro = e; continue;
            }
            throw e;
        }
    }
    throw ultimoErro || new Error("Todos os modelos Gemini falharam");
}


// ────────────────────────────────────────────────────────────────
//  [2] Na função carregarDados(), adicione a chamada abaixo
//      LOGO APÓS as linhas de Promise.all([...]):
//
//      await carregarConfiguracaoIA();
//
//  Exemplo — seu carregarDados() ficará assim no trecho final:
//
//      planejamentos    = planSnap.exists() ? ... : {};
//      horarioProfessor = horSnap.exists()  ? ... : {};
//      await carregarConfiguracaoIA();   // ← ADICIONE ESTA LINHA
//
//      if (confSnap.exists() && ...) { ... }
// ────────────────────────────────────────────────────────────────


// ────────────────────────────────────────────────────────────────
//  [3] Na função abrirPainelAdmin(), localize o bloco de botões:
//
//      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
//          ${isSuperAdmin ? `<button ...>+ Nova Escola</button>` : ''}
//          <button ...>+ Convidar Professor</button>
//      </div>
//
//  Substitua por:
//
//      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
//          ${isSuperAdmin ? `<button class="btn-outline" onclick="abrirModalNovaEscola()">+ Nova Escola</button>` : ''}
//          <button class="btn-outline" onclick="abrirModalConvidarProfessor()">+ Convidar Professor</button>
//          ${isSuperAdmin ? `<button class="btn-outline btn-outline-ia" onclick="fecharModalAdmin();abrirModalConfigIA()">🤖 Configurar IA</button>` : ''}
//      </div>
// ────────────────────────────────────────────────────────────────


// ────────────────────────────────────────────────────────────────
//  [4] ADICIONE esta nova função em qualquer lugar do script
//      (sugerido: logo após fecharModalAdmin)
// ────────────────────────────────────────────────────────────────

async function abrirModalConfigIA() {
    // Apenas superadmin
    if (perfilUsuario?.tipo !== 'superadmin') {
        showToast('Acesso restrito ao superadministrador', 'error'); return;
    }

    mostrarLoading(true);
    let cfgAtual = { geminiKey: '', modelo: '', ativo: true };
    try {
        const snap = await getDoc(doc(db, 'configuracoes_sistema', 'ia'));
        if (snap.exists()) cfgAtual = { ...cfgAtual, ...snap.data() };
    } catch(e) { /* doc ainda não existe */ }
    mostrarLoading(false);

    const modal = document.createElement('div');
    modal.id = 'modalConfigIA';
    modal.className = 'modal-backdrop';

    // Status visual da chave atual
    const temChave = !!cfgAtual.geminiKey;
    const chavePreview = temChave
        ? cfgAtual.geminiKey.slice(0, 8) + '••••••••••••••••' + cfgAtual.geminiKey.slice(-4)
        : '';

    modal.innerHTML = `
    <div class="modal-box modal-sm">
        <div class="modal-header">
            <h3>🤖 Configurar IA (Gemini)</h3>
            <button class="modal-close" onclick="fecharModalConfigIA()">✕</button>
        </div>

        <!-- Status atual -->
        <div class="ia-status-card ${temChave ? 'ia-status-ok' : 'ia-status-off'}">
            <div class="ia-status-icon">${temChave ? '✅' : '⚠️'}</div>
            <div class="ia-status-info">
                <strong>${temChave ? 'IA configurada' : 'IA não configurada'}</strong>
                <small>${temChave ? chavePreview : 'Nenhuma chave salva. Os professores não poderão usar a geração automática.'}</small>
            </div>
        </div>

        <!-- Como obter a chave -->
        <div class="ia-instrucoes">
            <p>🔑 <strong>Como obter sua chave gratuita:</strong></p>
            <ol>
                <li>Acesse <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com/app/apikey</a></li>
                <li>Faça login com sua conta Google</li>
                <li>Clique em <em>"Create API Key"</em></li>
                <li>Copie a chave gerada e cole abaixo</li>
            </ol>
        </div>

        <!-- Campo da chave -->
        <div class="field-group" style="margin-top:20px;">
            <label>Chave da API Gemini</label>
            <div class="ia-key-wrap">
                <input
                    type="password"
                    id="iaGeminiKey"
                    class="perfil-input"
                    placeholder="${temChave ? 'Nova chave (deixe vazio para manter)' : 'Cole sua chave aqui...'}"
                    autocomplete="off"
                    spellcheck="false"
                    style="font-family:monospace;letter-spacing:.05em;"
                />
                <button class="ia-eye-btn" type="button" onclick="toggleVisibilidadeChave()" title="Mostrar/ocultar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
            </div>
        </div>

        <!-- Modelo preferido -->
        <div class="field-group">
            <label>Modelo preferido</label>
            <select id="iaModeloPreferido" class="perfil-input" style="appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 12px center;background-size:16px;padding-right:36px;">
                <option value="" ${!cfgAtual.modelo ? 'selected' : ''}>Automático (tenta do mais rápido ao mais robusto)</option>
                <option value="gemini-2.0-flash-lite" ${cfgAtual.modelo === 'gemini-2.0-flash-lite' ? 'selected' : ''}>gemini-2.0-flash-lite — Mais rápido, free tier generoso</option>
                <option value="gemini-2.0-flash"      ${cfgAtual.modelo === 'gemini-2.0-flash'      ? 'selected' : ''}>gemini-2.0-flash — Melhor qualidade, ainda gratuito</option>
                <option value="gemini-1.5-flash"      ${cfgAtual.modelo === 'gemini-1.5-flash'      ? 'selected' : ''}>gemini-1.5-flash — Fallback estável e bem testado</option>
            </select>
            <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:5px;">
                No modo Automático, o sistema faz fallback para o próximo modelo se houver erro de quota.
            </span>
        </div>

        <!-- Toggle ativo -->
        <div class="ia-toggle-row">
            <div>
                <strong>IA ativada para todos os professores</strong>
                <small>Quando desativada, o botão ✨ IA fica oculto para todos</small>
            </div>
            <label class="ia-toggle">
                <input type="checkbox" id="iaAtivo" ${cfgAtual.ativo !== false ? 'checked' : ''}>
                <span class="ia-toggle-slider"></span>
            </label>
        </div>

        ${temChave ? `
        <button class="ia-btn-remover" onclick="removerChaveIA()">🗑️ Remover chave salva</button>
        ` : ''}

        <div class="modal-footer">
            <button class="btn-cancel" onclick="fecharModalConfigIA()">Cancelar</button>
            <button class="btn-save" onclick="salvarConfiguracaoIA()">💾 Salvar Configuração</button>
        </div>
    </div>`;

    document.body.appendChild(modal);
}

function fecharModalConfigIA() {
    document.getElementById('modalConfigIA')?.remove();
}

window.toggleVisibilidadeChave = function() {
    const inp = document.getElementById('iaGeminiKey');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
};

async function salvarConfiguracaoIA() {
    const novaChave = document.getElementById('iaGeminiKey')?.value.trim();
    const modelo    = document.getElementById('iaModeloPreferido')?.value || '';
    const ativo     = document.getElementById('iaAtivo')?.checked ?? true;

    // Validação básica: chave Gemini começa com "AIza"
    if (novaChave && !novaChave.startsWith('AIza')) {
        showToast('Chave inválida. Chaves Gemini começam com "AIza"', 'error');
        return;
    }

    mostrarLoading(true);
    try {
        // Se campo vazio, mantém a chave atual (não sobrescreve)
        const dadosParaSalvar = { modelo, ativo, atualizadoEm: new Date().toISOString() };
        if (novaChave) dadosParaSalvar.geminiKey = novaChave;

        await setDoc(
            doc(db, 'configuracoes_sistema', 'ia'),
            dadosParaSalvar,
            { merge: true }  // merge = não apaga geminiKey se campo ficou vazio
        );

        // Atualiza em memória imediatamente
        if (novaChave) GEMINI_API_KEY = novaChave;
        GEMINI_MODELO_PREFERIDO = modelo;

        showToast('Configuração de IA salva! ✅', 'success');
        fecharModalConfigIA();
    } catch(e) {
        showToast('Erro ao salvar: ' + e.message, 'error');
    } finally {
        mostrarLoading(false);
    }
}

window.removerChaveIA = async function() {
    if (!confirm('Remover a chave da API? Os professores não poderão usar a IA até que uma nova chave seja configurada.')) return;
    mostrarLoading(true);
    try {
        await setDoc(doc(db, 'configuracoes_sistema', 'ia'), { geminiKey: '', ativo: false, atualizadoEm: new Date().toISOString() }, { merge: true });
        GEMINI_API_KEY = '';
        showToast('Chave removida.', 'success');
        fecharModalConfigIA();
    } catch(e) {
        showToast('Erro: ' + e.message, 'error');
    } finally {
        mostrarLoading(false);
    }
};


// ────────────────────────────────────────────────────────────────
//  [5] No Object.assign(window, {...}) no final do arquivo,
//      adicione as novas funções:
//
//      abrirModalConfigIA, fecharModalConfigIA, salvarConfiguracaoIA
//
//  Exemplo — sua linha ficará assim:
//
//      Object.assign(window, {
//          ...tudo que já estava...
//          abrirModalConfigIA, fecharModalConfigIA, salvarConfiguracaoIA,
//      });
// ────────────────────────────────────────────────────────────────
