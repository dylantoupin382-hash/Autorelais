const COOKIE = "autorelais_admin";
const STATUTS = new Set(["nouveau", "contacte", "rdv", "vendu", "refuse"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    // CONNEXION ADMIN
    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));

      if (
        !env.ADMIN_PASSWORD ||
        !same(String(body.password || ""), String(env.ADMIN_PASSWORD))
      ) {
        return json({ error: "Mot de passe incorrect" }, 401);
      }

      const token = await makeToken(env.ADMIN_PASSWORD);

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "set-cookie":
            `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
        }
      });
    }

    // DÉCONNEXION
    if (url.pathname === "/api/admin/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "set-cookie":
            `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
        }
      });
    }

    // VÉRIFICATION SESSION
    if (url.pathname === "/api/admin/me") {
      if (!(await isAdmin(request, env))) {
        return json({ error: "Non autorisé" }, 401);
      }

      return json({ ok: true });
    }

    // LISTE DES DEMANDES VENDEURS
    if (
      url.pathname === "/api/admin/demandes" &&
      request.method === "GET"
    ) {
      if (!(await isAdmin(request, env))) {
        return json({ error: "Non autorisé" }, 401);
      }

      const result = await env.DB.prepare(`
        SELECT
          v.id AS vehicule_id,
          v.marque,
          v.modele,
          v.annee,
          v.kilometrage,
          v.prix_souhaite,
          v.energie,
          v.boite,
          v.immatriculation,
          v.description,
          v.statut,
          v.created_at,
          s.id AS vendeur_id,
          s.prenom,
          s.nom,
          s.telephone,
          s.email,
          s.ville
        FROM vehicules v
        JOIN vendeurs s ON s.id = v.vendeur_id
        ORDER BY v.created_at DESC
        LIMIT 300
      `).all();

      return json({ demandes: result.results || [] });
    }

    // MODIFIER LE STATUT
    const match = url.pathname.match(
      /^\/api\/admin\/vehicules\/(\d+)\/statut$/
    );

    if (match && request.method === "PATCH") {
      if (!(await isAdmin(request, env))) {
        return json({ error: "Non autorisé" }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const statut = String(body.statut || "");

      if (!STATUTS.has(statut)) {
        return json({ error: "Statut invalide" }, 400);
      }

      await env.DB.prepare(
        "UPDATE vehicules SET statut = ? WHERE id = ?"
      )
        .bind(statut, Number(match[1]))
        .run();

      return json({ ok: true });
    }

    // FORMULAIRE VENDEUR
    if (
      url.pathname === "/api/vendeur" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const required = [
          "prenom",
          "nom",
          "telephone",
          "email",
          "ville",
          "marque",
          "modele"
        ];

        for (const key of required) {
          if (!String(data[key] ?? "").trim()) {
            return json(
              { error: "Champ requis : " + key },
              400
            );
          }
        }

        const vendeur = await env.DB.prepare(`
          INSERT INTO vendeurs
          (prenom, nom, telephone, email, ville)
          VALUES (?, ?, ?, ?, ?)
        `)
          .bind(
            String(data.prenom).trim(),
            String(data.nom).trim(),
            String(data.telephone).trim(),
            String(data.email).trim(),
            String(data.ville).trim()
          )
          .run();

        const vendeurId = vendeur.meta.last_row_id;

        await env.DB.prepare(`
          INSERT INTO vehicules
          (
            vendeur_id,
            marque,
            modele,
            annee,
            kilometrage,
            prix_souhaite,
            energie,
            boite,
            immatriculation,
            description,
            statut
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nouveau')
        `)
          .bind(
            vendeurId,
            String(data.marque).trim(),
            String(data.modele).trim(),
            Number(data.annee) || null,
            Number(data.kilometrage) || null,
            Number(data.prix_souhaite) || null,
            String(data.energie ?? "").trim(),
            String(data.boite ?? "").trim(),
            String(data.immatriculation ?? "").trim(),
            String(data.description ?? "").trim()
          )
          .run();

        return json({ ok: true }, 201);

      } catch (error) {
        return json(
          { error: "Impossible d'enregistrer la demande." },
          500
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};

async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;

  const cookies = request.headers.get("cookie") || "";
  const token = cookies
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE + "="))
    ?.split("=")[1];

  if (!token) return false;

  const expected = await makeToken(env.ADMIN_PASSWORD);

  return same(token, expected);
}

async function makeToken(secret) {
  const data = new TextEncoder().encode(
    "autorelais-admin-" + secret
  );

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function same(a, b) {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
