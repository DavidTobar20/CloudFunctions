const {
    onDocumentUpdated,
    onDocumentCreated,
} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.updateUserInfoInReviews = onDocumentUpdated(
    "users/{userId}",
    async (event) => {
        const userId = event.params.userId;

        const beforeData = event.data.before.data();
        const afterData = event.data.after.data();

        if (beforeData.foto_url === afterData.foto_url) {
            logger.log("No change in profile image, skipping update.");
            return;
        }

        logger.log("Actualizando reviews del usuario:", userId);

        // 1. Reseñas escritas por el usuario (donde es el autor)
        const writtenReviewsSnapshot = await db
            .collection("reviews")
            .where("autor_id", "==", userId)
            .get();

        // 2. Reseñas recibidas por el usuario (donde es el reseñado)
        const receivedReviewsSnapshot = await db
            .collection("reviews")
            .where("resenado_id", "==", userId)
            .get();

        // 3. Inscripciones del usuario (pantalla de Reseñas)
        const inscripcionesSnapshot = await db
            .collection("inscripciones")
            .where("usuario.id", "==", userId)
            .get();

        // 4. Notificaciones enviadas por el usuario (donde es el emisor)
        const notificacionesSnapshot = await db
            .collection("notificaciones")
            .where("emisorId", "==", userId)
            .get();

        const batch = db.batch();

        writtenReviewsSnapshot.forEach((reviewDoc) => {
            batch.update(reviewDoc.ref, {
                "autor.foto_url": afterData.foto_url,
            });
        });

        receivedReviewsSnapshot.forEach((reviewDoc) => {
            batch.update(reviewDoc.ref, {
                "resenado.foto_url": afterData.foto_url,
            });
        });

        inscripcionesSnapshot.forEach((inscripcionDoc) => {
            batch.update(inscripcionDoc.ref, {
                "usuario.foto_url": afterData.foto_url,
            });
        });

        notificacionesSnapshot.forEach((notificacionDoc) => {
            batch.update(notificacionDoc.ref, {
                "emisor.foto_url": afterData.foto_url,
            });
        });

        await batch.commit();
        logger.log("Reviews actualizadas exitosamente para el usuario:", userId);
    }
);

exports.sendFollowNotification = onDocumentCreated(
    "users/{userId}/followers/{followerId}",
    async (event) => {
        // userId = a quien siguieron (a el le llega la notificacion)
        // followerId = quien empezo a seguir
        const userId = event.params.userId;
        const followerId = event.params.followerId;

        // 1. Token FCM del usuario que recibe el nuevo seguidor
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.data();
        const userToken = userData.fcmtoken;

        // 2. Datos de quien lo empezo a seguir
        const followerDoc = await db.collection("users").doc(followerId).get();
        const followerData = followerDoc.data();
        const followerName = followerData.nombre;

        // 3. Guardar la notificacion para que salga en la pantalla de Notificaciones
        await db.collection("notificaciones").add({
            destinatarioId: userId,
            emisorId: followerId,
            tipo: "FOLLOW",
            emisor: {
                id: followerId,
                nombre: followerData.nombre || "",
                nombre_usuario: followerData.nombre_usuario || "",
                foto_url: followerData.foto_url || "",
                color_perfil: followerData.color_perfil || "",
            },
            fechaCreacion: admin.firestore.Timestamp.now(),
        });

        // 4. Armar y enviar el mensaje push
        if (userToken) {
            const message = {
                token: userToken,
                notification: {
                    title: "Nuevo seguidor",
                    body: `${followerName} ha comenzado a seguirte`,
                },
            };

            try {
                await admin.messaging().send(message);
                logger.log("Notificacion enviada de", followerId, "a", userId);
            } catch (error) {
                logger.error("Error al enviar la notificacion:", error);
            }
        } else {
            logger.log("El usuario", userId, "no tiene FCM token");
        }
    }
);

exports.sendLikeNotification = onDocumentCreated(
    "reviews/{reviewId}/likes/{userId}",
    async (event) => {
        // reviewId = la reseña que recibio el like
        // userId = quien dio el like
        const reviewId = event.params.reviewId;
        const userId = event.params.userId;

        // 1. Buscar la reseña para saber quien es el autor (a el le llega la notificacion)
        const reviewDoc = await db.collection("reviews").doc(reviewId).get();
        const reviewData = reviewDoc.data();
        const autorId = reviewData.autor_id;

        // Si el autor se dio like a si mismo, no se notifica
        if (autorId === userId) {
            logger.log("El autor se dio like a si mismo, no se envia notificacion.");
            return;
        }

        // 2. Token FCM del autor de la reseña
        const autorDoc = await db.collection("users").doc(autorId).get();
        const autorData = autorDoc.data();
        const autorToken = autorData.fcmtoken;

        // 3. Datos de quien dio el like
        const likerDoc = await db.collection("users").doc(userId).get();
        const likerData = likerDoc.data();
        const likerName = likerData.nombre;

        // 4. Guardar la notificacion para que salga en la pantalla de Notificaciones
        await db.collection("notificaciones").add({
            destinatarioId: autorId,
            emisorId: userId,
            tipo: "LIKE",
            resenaId: reviewId,
            resenaDe: reviewData.resenado ? reviewData.resenado.nombre : "",
            materia: reviewData.materia || "",
            emisor: {
                id: userId,
                nombre: likerData.nombre || "",
                nombre_usuario: likerData.nombre_usuario || "",
                foto_url: likerData.foto_url || "",
                color_perfil: likerData.color_perfil || "",
            },
            fechaCreacion: admin.firestore.Timestamp.now(),
        });

        // 5. Armar y enviar el mensaje push
        if (autorToken) {
            const message = {
                token: autorToken,
                notification: {
                    title: "Nuevo like",
                    body: `A ${likerName} le gustó tu reseña de ${reviewData.materia}`,
                },
            };

            try {
                await admin.messaging().send(message);
                logger.log("Notificacion de like enviada de", userId, "a", autorId);
            } catch (error) {
                logger.error("Error al enviar la notificacion de like:", error);
            }
        } else {
            logger.log("El usuario", autorId, "no tiene FCM token");
        }
    }
);