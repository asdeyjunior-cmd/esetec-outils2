/*
 * ESETEC Marketplace — nettoyage et réparation des comptes (à lancer sur ton PC, PAS sur le site)
 *
 *   node nettoyage.js              → APERÇU : affiche ce qui serait fait, ne modifie rien
 *   node nettoyage.js --appliquer  → applique réellement les changements
 *   node nettoyage.js --auto       → mode automatique (GitHub, toutes les 12 h) : applique le nettoyage,
 *                                    ne crée aucun compte, et prévient l'admin sur ntfy s'il a supprimé quelque chose
 *
 * La clé administrateur est lue dans la variable d'environnement FIREBASE_CLE (GitHub),
 * sinon dans le fichier cle.json à côté du script (sur ton PC).
 *
 * Ce que fait le script :
 *  1. Supprime les vendeurs refusés (fiche, profil public, code de parrainage, compte de connexion).
 *  2. Répare les anciennes fiches vendeurs (rangées sous une clé « -N… » ou avec un mot de passe en clair) :
 *     - si un compte de connexion existe déjà pour cet email (ex. ton compte admin) → la fiche lui est rattachée ;
 *     - sinon → le compte de connexion est créé (même mot de passe ; s'il est trop court, un lien
 *       pour en choisir un nouveau est affiché).
 *  3. Supprime les restes : profils publics et codes de parrainage dont le vendeur n'existe plus.
 *  4. Supprime les comptes de connexion fantômes : comptes qui ne sont ni admin ni liés à une fiche vendeur
 *     (vendeurs supprimés, inscriptions abandonnées…).
 *
 *  5. Supprime ce qui est terminé : articles expirés (et leurs favoris et publicités), publicités dont la durée
 *     est finie, demandes de publicité d'articles supprimés ou traitées depuis plus de 60 jours,
 *     événements passés depuis plus d'un jour, demandes d'événements dont la date est passée.
 *
 * Retraits, filleuls et soldes ne sont jamais supprimés. Un compte de connexion créé depuis moins de 48 h
 * n'est jamais supprimé (le vendeur est peut-être en train de payer son inscription).
 */
const admin = require("firebase-admin");
const cle = process.env.FIREBASE_CLE ? JSON.parse(process.env.FIREBASE_CLE) : require("./cle.json");

admin.initializeApp({
    credential: admin.credential.cert(cle),
    databaseURL: "https://esetec-marketplace-default-rtdb.firebaseio.com"
});

const AUTO = process.argv.includes("--auto");
const APPLIQUER = AUTO || process.argv.includes("--appliquer");
const JOUR = 24 * 60 * 60 * 1000;
const SUJET_ADMIN = "esetec-admin-g6pwv919np25zq";   // même sujet ntfy que le site (ntfy.js)
const db = admin.database();
const auth = admin.auth();

async function lire(chemin) {
    return (await db.ref(chemin).get()).val() || {};
}

async function tousLesComptes() {
    const liste = [];
    let page;
    do {
        const r = await auth.listUsers(1000, page);
        liste.push(...r.users);
        page = r.pageToken;
    } while (page);
    return liste;
}

function nomDe(v, id) { return (v && (v.nom || v.email)) || id; }

function motDePasseProvisoire() {
    return "Esetec-" + require("crypto").randomBytes(6).toString("hex");
}

async function principal() {
    console.log(AUTO ? "\n=== MODE AUTOMATIQUE (" + new Date().toISOString() + ") ===\n"
              : APPLIQUER ? "\n=== MODE APPLICATION : les changements sont enregistrés ===\n"
                          : "\n=== APERÇU : rien n'est modifié (ajoutez --appliquer pour appliquer) ===\n");

    const [vendeurs, admins, publics, parrainages, retraits, demandes] = await Promise.all(
        ["vendeurs", "admins", "vendeursPublics", "parrainages", "retraits", "demandes_pub"].map(lire));
    const comptes = await tousLesComptes();
    const compteParUid = new Map(comptes.map(u => [u.uid, u]));
    const compteParEmail = new Map(comptes.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));
    const estAdmin = uid => admins[uid] === true;

    const maj = {};
    const comptesASupprimer = new Set();
    let n = { refuses: 0, repares: 0, crees: 0, publics: 0, codes: 0, fantomes: 0, termines: 0 };
    const recent = u => Date.now() - new Date(u.metadata.creationTime).getTime() < 2 * JOUR;

    // ── 1. Vendeurs refusés ──
    console.log("1) Vendeurs refusés à supprimer");
    for (const id of Object.keys(vendeurs)) {
        const v = vendeurs[id];
        if (!v || v.statut !== "refuse") continue;
        console.log("   - " + nomDe(v, id) + " (" + (v.email || "sans email") + ")");
        maj["vendeurs/" + id] = null;
        maj["vendeursPublics/" + id] = null;
        if (v.codeParrainage) maj["parrainages/" + v.codeParrainage] = null;
        const compte = compteParUid.get(id) || compteParEmail.get(String(v.email || "").toLowerCase());
        if (compte && !estAdmin(compte.uid) && !recent(compte)) comptesASupprimer.add(compte.uid);
        delete vendeurs[id];
        n.refuses++;
    }
    if (!n.refuses) console.log("   (aucun)");

    // ── 2. Anciennes fiches à réparer ──
    console.log("\n2) Anciennes fiches vendeurs à réparer");
    const anciennes = Object.keys(vendeurs).filter(id => vendeurs[id] && (vendeurs[id].mdp || id.startsWith("-")));
    // En automatique, les anciennes fiches sont seulement signalées ; leurs comptes et profils sont protégés
    const emailsProteges = new Set();
    if (AUTO && anciennes.length) {
        console.log("   " + anciennes.length + " ancienne(s) fiche(s) à réparer : lancez « node nettoyage.js --appliquer » sur votre PC (non fait en automatique).");
        anciennes.forEach(id => emailsProteges.add(String(vendeurs[id].email || "").trim().toLowerCase()));
        anciennes.length = 0;
    }
    for (const ancien of anciennes) {
        const v = vendeurs[ancien];
        const email = String(v.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.log("   Attention : " + nomDe(v, ancien) + " : email invalide, ignoré"); continue; }

        let compte = compteParEmail.get(email);
        let lienMdp = null;
        if (compte) {
            if (vendeurs[compte.uid] && compte.uid !== ancien) {
                console.log("   Attention : " + nomDe(v, ancien) + " : une fiche existe déjà pour " + email + " → ancienne fiche en double supprimée");
                maj["vendeurs/" + ancien] = null;
                delete vendeurs[ancien];
                continue;
            }
            console.log("   - " + nomDe(v, ancien) + " → rattaché au compte existant " + email + (estAdmin(compte.uid) ? " (compte admin)" : ""));
        } else {
            const mdp = v.mdp ? String(v.mdp) : "";
            const provisoire = mdp.length < 6;
            console.log("   - " + nomDe(v, ancien) + " → création du compte " + email + (provisoire ? " (mot de passe à choisir via un lien)" : ""));
            if (APPLIQUER) {
                compte = await auth.createUser({ email: email, password: provisoire ? motDePasseProvisoire() : mdp, displayName: v.nom || undefined });
                compteParEmail.set(email, compte);
                compteParUid.set(compte.uid, compte);
                if (provisoire) lienMdp = await auth.generatePasswordResetLink(email);
            }
            n.crees++;
        }
        if (lienMdp) console.log("     Lien à envoyer au vendeur pour choisir son mot de passe :\n     " + lienMdp);

        if (!compte) { n.repares++; continue; }   // aperçu : le compte n'existe pas encore
        const uid = compte.uid;
        const nouveau = Object.assign({}, v, { email: email, uid: uid });
        delete nouveau.mdp;
        if (uid !== ancien) {
            maj["vendeurs/" + ancien] = null;
            for (const x of Object.keys(vendeurs)) {
                const o = vendeurs[x];
                if (x === ancien || !o) continue;
                if (o.parrainId === ancien) { maj["vendeurs/" + x + "/parrainId"] = uid; o.parrainId = uid; }
                if (o.filleuls && o.filleuls[ancien]) {
                    maj["vendeurs/" + x + "/filleuls/" + ancien] = null;
                    maj["vendeurs/" + x + "/filleuls/" + uid] = o.filleuls[ancien];
                    o.filleuls[uid] = o.filleuls[ancien];
                    delete o.filleuls[ancien];
                }
            }
            for (const k of Object.keys(retraits)) if (retraits[k] && retraits[k].vendeurId === ancien) { maj["retraits/" + k + "/vendeurId"] = uid; retraits[k].vendeurId = uid; }
            for (const k of Object.keys(demandes)) if (demandes[k] && demandes[k].vendeurId === ancien) { maj["demandes_pub/" + k + "/vendeurId"] = uid; demandes[k].vendeurId = uid; }
            if (v.codeParrainage) { maj["parrainages/" + v.codeParrainage] = uid; parrainages[v.codeParrainage] = uid; }
            maj["vendeursPublics/" + ancien] = null;
        }
        maj["vendeurs/" + uid] = nouveau;
        maj["vendeursPublics/" + uid] = { nom: v.nom || "", email: email, photo: v.photo || null, whatsapp: v.whatsapp || "" };
        publics[uid] = maj["vendeursPublics/" + uid];
        delete publics[ancien];
        delete vendeurs[ancien];
        vendeurs[uid] = nouveau;
        n.repares++;
    }
    if (!anciennes.length && !emailsProteges.size) console.log("   (aucune)");

    // ── 3. Restes de vendeurs supprimés ──
    console.log("\n3) Restes de vendeurs supprimés");
    for (const id of Object.keys(publics)) {
        if (!vendeurs[id] && maj["vendeursPublics/" + id] === undefined) {
            console.log("   - profil public orphelin : " + nomDe(publics[id], id));
            maj["vendeursPublics/" + id] = null;
            n.publics++;
        }
    }
    for (const code of Object.keys(parrainages)) {
        if (!vendeurs[parrainages[code]] && maj["parrainages/" + code] === undefined) {
            console.log("   - code de parrainage orphelin : " + code);
            maj["parrainages/" + code] = null;
            n.codes++;
        }
    }
    if (!n.publics && !n.codes) console.log("   (aucun)");

    // ── 4. Comptes de connexion fantômes ──
    console.log("\n4) Comptes de connexion fantômes (ni admin, ni vendeur)");
    for (const u of compteParUid.values()) {
        if (estAdmin(u.uid) || vendeurs[u.uid]) continue;
        if (recent(u)) continue;   // inscription peut-être en cours (paiement Wave)
        if (u.email && emailsProteges.has(u.email.toLowerCase())) continue;   // ancienne fiche pas encore réparée
        comptesASupprimer.add(u.uid);
    }
    for (const uid of comptesASupprimer) {
        const u = compteParUid.get(uid);
        console.log("   - " + ((u && u.email) || uid));
        n.fantomes++;
    }
    if (!n.fantomes) console.log("   (aucun)");

    // ── 5. Contenus terminés ──
    console.log("\n5) Articles, publicités et événements terminés");
    const [articles, favoris, pubs, demPub, evts, demEvt] = await Promise.all(
        ["articles", "favorisCompteur", "publicites", "demandes_pub", "evenements", "demandes_evenements"].map(lire));
    const maintenant = Date.now();
    const finJour = d => { const x = new Date(String(d).slice(0, 10) + "T23:59:59Z").getTime(); return isNaN(x) ? 0 : x; };
    const suppr = (chemin, texte) => { if (maj[chemin] === undefined) { maj[chemin] = null; n.termines++; console.log("   - " + texte); } };
    for (const id of Object.keys(articles)) {
        const a = articles[id];
        if (a && a.dateExpiration && maintenant > a.dateExpiration) { suppr("articles/" + id, "article expiré : " + (a.nom || id)); delete articles[id]; }
    }
    for (const id of Object.keys(favoris)) if (!articles[id]) suppr("favorisCompteur/" + id, "compteur de favoris orphelin : " + id);
    for (const id of Object.keys(pubs)) {
        const p = pubs[id] || {};
        if (p.idArticle && !articles[p.idArticle]) suppr("publicites/" + id, "publicité d'un article supprimé : " + (p.titre || id));
        else if (p.dateFin && p.dateFin < maintenant) suppr("publicites/" + id, "publicité terminée : " + (p.titre || id));
    }
    for (const id of Object.keys(demPub)) {
        const d = demPub[id] || {};
        const age = maintenant - (new Date(d.date).getTime() || maintenant);
        if ((d.articleId && !articles[d.articleId]) || (d.statut !== "en_attente" && age > 60 * JOUR)) suppr("demandes_pub/" + id, "demande de publicité terminée : " + (d.articleNom || id));
        else if (d.paiement === "en_cours" && age > 2 * JOUR) suppr("demandes_pub/" + id, "demande de publicité jamais payée : " + (d.articleNom || id));
    }
    for (const id of Object.keys(evts)) {
        const e = evts[id] || {};
        if (finJour(e.date) < maintenant - JOUR) suppr("evenements/" + id, "événement passé : " + (e.titre || id));
    }
    for (const id of Object.keys(demEvt)) {
        const d = demEvt[id] || {};
        if (finJour(d.date) < maintenant - JOUR) suppr("demandes_evenements/" + id, "demande d'événement expirée : " + (d.titre || id));
    }
    if (!n.termines) console.log("   (rien)");

    // ── Application ──
    // Firebase refuse une mise à jour qui contient à la fois "a" et "a/b" : les objets complets
    // ("a") contiennent déjà les dernières modifications, on retire donc les chemins enfants.
    const cles = Object.keys(maj);
    for (const k of cles) {
        if (cles.some(p => p !== k && k.startsWith(p + "/"))) delete maj[k];
    }

    if (APPLIQUER) {
        if (Object.keys(maj).length) await db.ref().update(maj);
        if (comptesASupprimer.size) await auth.deleteUsers([...comptesASupprimer]);
    }

    const resume = n.refuses + " refusé(s) supprimé(s), " + n.repares + " fiche(s) réparée(s) dont " + n.crees +
        " compte(s) créé(s), " + n.publics + " profil(s) public(s) et " + n.codes + " code(s) orphelin(s), " + n.fantomes + " compte(s) fantôme(s), " +
        n.termines + " contenu(s) terminé(s).";
    console.log("\nRésumé : " + resume);
    console.log(APPLIQUER ? "Terminé.\n" : "\nRien n'a été modifié. Si la liste est correcte : node nettoyage.js --appliquer\n");

    // Mode automatique : l'admin est prévenu seulement s'il y a eu des suppressions
    const total = n.refuses + n.publics + n.codes + n.fantomes + n.termines;
    if (AUTO && total > 0 && typeof fetch === "function") {
        try {
            await fetch("https://ntfy.sh/", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: SUJET_ADMIN, title: "Nettoyage automatique ESETEC", message: resume, tags: [], priority: 2,
                                       icon: "https://eseteconlinemarket.com/icon-192.png" })
            });
        } catch (e) { console.log("Notification ntfy non envoyée : " + (e.message || e)); }
    }
    process.exit(0);
}

principal().catch(e => { console.error("Erreur :", e.message || e); process.exit(1); });
