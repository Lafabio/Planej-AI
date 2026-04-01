import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "SUA_API_KEY",
    authDomain: "SEU_PROJETO.firebaseapp.com",
    projectId: "SEU_PROJETO",
    storageBucket: "SEU_PROJETO.appspot.com",
    messagingSenderId: "ID",
    appId: "APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTADO GLOBAL ---
let usuarioAtual = null;
let configEscola = {
    inicio: "07:30",
    duracaoAula: 50,
    numAulas: 6,
    aulaRecreio: 3,
    duracaoRecreio: 20
};

// --- AUTENTICAÇÃO ---
async function fazerCadastro() {
    const email = document.getElementById('regEmail').value;
    const senha = document.getElementById('regPassword').value;
    const nome = document.getElementById('regNome').value;
    const escola = document.getElementById('regEscola').value;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
        await updateProfile(userCredential.user, { displayName: nome });
        
        // Salva dados iniciais da escola no Firestore
        await setDoc(doc(db, "usuarios", userCredential.user.uid), {
            nome, escola, configEscola
        });
        
        alert("Conta criada com sucesso!");
    } catch (error) {
        alert("Erro ao cadastrar: " + error.message);
    }
}

async function fazerLogin() {
    const email = document.getElementById('loginEmail').value;
    const senha = document.getElementById('loginPassword').value;
    try {
        await signInWithEmailAndPassword(auth, email, senha);
    } catch (error) {
        alert("Erro no login: Verifique suas credenciais.");
    }
}

async function iniciarRecuperacao() {
    const email = document.getElementById('resetEmail').value;
    if(!email) return alert("Digite seu email.");
    try {
        await sendPasswordResetEmail(auth, email);
        alert("Email de recuperação enviado! Verifique sua caixa de entrada.");
        mostrarLogin();
    } catch (error) {
        alert("Erro: " + error.message);
    }
}

function fazerLogout() {
    signOut(auth);
}

// --- LÓGICA DE HORÁRIOS ---
function gerarGradeHoraria() {
    const { inicio, duracaoAula, numAulas, aulaRecreio, duracaoRecreio } = configEscola;
    let html = '<table><thead><tr><th>Horário</th><th>Seg</th><th>Ter</th><th>Qua</th><th>Qui</th><th>Sex</th></tr></thead><tbody>';
    
    let horaAtual = new Date(`2024-01-01T${inicio}:00`);

    for (let i = 1; i <= numAulas; i++) {
        let fimAula = new Date(horaAtual.getTime() + duracaoAula * 60000);
        
        const faixa = `${horaAtual.toTimeString().slice(0,5)} - ${fimAula.toTimeString().slice(0,5)}`;
        html += `<tr><td>${faixa}</td>${'<td><div class="celula-aula" contenteditable="true"></div></td>'.repeat(5)}</tr>`;
        
        horaAtual = fimAula;

        // Inserir recreio
        if (i === parseInt(aulaRecreio)) {
            let fimRecreio = new Date(horaAtual.getTime() + duracaoRecreio * 60000);
            html += `<tr class="recreio-row"><td colspan="6">INTERVALO / RECREIO (${horaAtual.toTimeString().slice(0,5)} - ${fimRecreio.toTimeString().slice(0,5)})</td></tr>`;
            horaAtual = fimRecreio;
        }
    }
    
    html += '</tbody></table>';
    document.getElementById('gradeSemana').innerHTML = html;
}

async function salvarConfiguracoesEscola() {
    configEscola = {
        inicio: document.getElementById('cfgInicio').value,
        duracaoAula: parseInt(document.getElementById('cfgDuracao').value),
        numAulas: parseInt(document.getElementById('cfgNumAulas').value),
        aulaRecreio: parseInt(document.getElementById('cfgAulaRecreio').value),
        duracaoRecreio: parseInt(document.getElementById('cfgDuracaoRecreio').value)
    };

    if(usuarioAtual) {
        await setDoc(doc(db, "usuarios", usuarioAtual.uid), { configEscola }, { merge: true });
    }
    
    gerarGradeHoraria();
    fecharModalHorario();
}

// --- MONITOR DE ESTADO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        usuarioAtual = user;
        document.getElementById('authContainer').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('userName').innerText = user.displayName || "Professor";
        
        // Carregar dados do Firestore
        const docSnap = await getDoc(doc(db, "usuarios", user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('userSchool').innerText = data.escola || "Escola não definida";
            if(data.configEscola) configEscola = data.configEscola;
        }
        gerarGradeHoraria();
    } else {
        document.getElementById('authContainer').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
    }
});

// Funções de Navegação UI
window.mostrarCadastro = () => { document.getElementById('loginForm').classList.add('hidden'); document.getElementById('registerForm').classList.remove('hidden'); document.getElementById('authTitle').innerText = "Criar Conta"; };
window.mostrarLogin = () => { document.getElementById('registerForm').classList.add('hidden'); document.getElementById('resetForm').classList.add('hidden'); document.getElementById('loginForm').classList.remove('hidden'); document.getElementById('authTitle').innerText = "Acessar Sistema"; };
window.mostrarRecuperacao = () => { document.getElementById('loginForm').classList.add('hidden'); document.getElementById('resetForm').classList.remove('hidden'); document.getElementById('authTitle').innerText = "Recuperar Senha"; };
window.abrirConfiguracaoHorario = () => document.getElementById('modalHorario').classList.remove('hidden');
window.fecharModalHorario = () => document.getElementById('modalHorario').classList.add('hidden');
window.fazerLogin = fazerLogin;
window.fazerCadastro = fazerCadastro;
window.fazerLogout = fazerLogout;
window.iniciarRecuperacao = iniciarRecuperacao;
window.salvarConfiguracoesEscola = salvarConfiguracoesEscola;
