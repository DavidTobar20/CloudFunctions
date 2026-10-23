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

        // 2. Nombre de quien lo empezo a seguir
        const followerDoc = await db.collection("users").doc(followerId).get();
        const followerData = followerDoc.data();
        const followerName = followerData.nombre;

        // 3. Armar y enviar el mensaje
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