const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");


dotenv.config();


const stripe = require("stripe")(process.env.PATMENT_GATEWAY_KEY);


const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: 'https://simple-firebase-authenti-26eae.web.app',  // Frontend URL
    credentials: true
}));
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY,'base64').toString('utf8')
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@durjoys-db.smvgnqx.mongodb.net/?retryWrites=true&w=majority&appName=Durjoys-DB`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        const db = client.db('profastDB')
        const parcelCollection = db.collection('parcels');
        const paymentsCollection = db.collection('payments');
        const usersCollection = db.collection('users');
        const ridersCollection = db.collection('riders');
        const trackingsCollection = db.collection("trackings");


        //Custom Middlewares

        // Firebase Token Verifiation
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'UnAuthorized Access' });
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'UnAuthorized Access' });
            };
            // Verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            }
            catch (error) {
                return res.status(403).send({ message: 'Forbidden Access' });

            }

        };

        // Admin Role Varification
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden Access' });
            };

            next();
        }
        // Rider Role Varification
        const verifyRider = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'rider') {
                return res.status(403).send({ message: 'Forbidden Access' });
            };

            next();
        }


        // Getting & Posting the users
        app.get('/users', async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                res.status(200).send(users);
            } catch (error) {
                res.status(500).send({ message: 'Error retrieving users', error });
            }
        });

        // Searching user based on email
        app.get("/users/search", async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }

            const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users);
            } catch (error) {
                console.error("Error searching users", error);
                res.status(500).send({ message: "Error searching users" });
            }
        });


        // GET: Get user role by email
        app.get('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

        // Posting/Changing user role
        app.patch("/users/:id/role", verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            if (!["admin", "user"].includes(role)) {
                return res.status(400).send({ message: "Invalid role" });
            }

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                res.send({ message: `User role updated to ${role}`, result });
            } catch (error) {
                console.error("Error updating user role", error);
                res.status(500).send({ message: "Failed to update user role" });
            }
        });


        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await usersCollection.findOne({ email });
            if (userExists) {
                // Update last_log_in to current time
                const updatedUser = await usersCollection.findOneAndUpdate(
                    { email },
                    { $set: { last_log_in: new Date().toISOString() } },
                    { returnDocument: 'after' }  // Returns the updated document
                );

                return res.status(200).send({
                    message: 'User already exists. Updated last login time.',
                    inserted: false,
                    user: updatedUser.value
                });
            }
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        // Posting new rider
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await ridersCollection.insertOne(rider);
            res.status(200).send(result);
        });

        // Getting pending riders
        app.get("/riders/pending", verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollection
                    .find({ status: "pending" })
                    .toArray();

                res.send(pendingRiders);
            } catch (error) {
                console.error("Failed to load pending riders:", error);
                res.status(500).send({ message: "Failed to load pending riders" });
            }
        });

        app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
            const result = await ridersCollection.find({ status: "active" }).toArray();
            res.send(result);
        });

        app.get("/riders/available", async (req, res) => {
            const { district } = req.query;

            try {
                const riders = await ridersCollection
                    .find({
                        district,
                        // status: { $in: ["approved", "active"] },
                        // work_status: "available",
                    })
                    .toArray();

                res.send(riders);
            } catch (err) {
                res.status(500).send({ message: "Failed to load riders" });
            }
        });
        // Getting stats for the admin
         app.get('/parcels/delivery/status-count', async (req, res) => {
            const pipeline = [
                {
                    $group: {
                        _id: '$delivery_status',
                        count: {
                            $sum: 1
                        }
                    }
                },
                {
                    $project: {
                        status: '$_id',
                        count: 1,
                        _id: 0
                    }
                }
            ];

            const result = await parcelCollection.aggregate(pipeline).toArray();
            res.send(result);
        })



        // GET: Get pending delivery tasks for a rider
        app.get('/rider/parcels', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).send({ message: 'Rider email is required' });
                }

                const query = {
                    assigned_rider_email: email,
                    delivery_status: { $in: ['rider_assigned', 'in_transit'] },
                };

                const options = {
                    sort: { creation_date: -1 }, // Newest first
                };

                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching rider tasks:', error);
                res.status(500).send({ message: 'Failed to get rider tasks' });
            }
        });


        app.patch("/riders/:id/status", async (req, res) => {
            const { id } = req.params;
            const { status, email } = req.body;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set:
                {
                    status
                }
            }

            try {
                const result = await ridersCollection.updateOne(
                    query, updateDoc

                );

                // Update user role upon accepting request
                if (status === 'active') {
                    const userQuery = { email };
                    const userUpdatedDoc = {
                        $set: {
                            role: 'rider'
                        }
                    };
                    const roleResult = await usersCollection.updateOne(userQuery, userUpdatedDoc);

                }
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: "Failed to update rider status" });
            }
        });


        // Parcels api
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;

                let query = {};

                if (email) {
                    query = { created_by: email }
                }
                if (payment_status) {
                    query.payment_status = payment_status;
                }
                if (delivery_status) {
                    query.delivery_status = delivery_status;
                }

                const options = {
                    sort: { cretedAt: -1 }
                }
                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels)
            }
            catch (error) {
                console.error('Error fetching parcels', error)
                res.status(500).send({ message: 'Failed to fetch Parcel' });
            }
        }
        );

        // GET: Load completed parcel deliveries for a rider
        app.get('/rider/completed-parcels', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).send({ message: 'Rider email is required' });
                }

                const query = {
                    assigned_rider_email: email,
                    delivery_status: {
                        $in: ['delivered', 'service_center_delivered']
                    },
                };

                const options = {
                    sort: { creation_date: -1 }, // Latest first
                };

                const completedParcels = await parcelCollection.find(query, options).toArray();

                res.send(completedParcels);

            } catch (error) {
                console.error('Error loading completed parcels:', error);
                res.status(500).send({ message: 'Failed to load completed deliveries' });
            }
        });

        // Get A specific parcel by id
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
                if (!parcel) {
                    return res.status(404).send({ message: 'Parcel not found' });
                }
                res.send(parcel);
            }
            catch (error) {
                console.error('Error fetching parcel:', error);
                res.status(500).send({ message: 'Failed to fetch parcel' });
            }
        });

        // Posting the data
        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = req.body;
                const result = await parcelCollection.insertOne(newParcel);
                res.send(result);
            } catch (error) {
                console.error('Error Inserting Parcel:', error)
                res.status(500).send({ message: 'Failed to create Parcel' });
            }
        });


        // GET: Get pending delivery tasks for a rider
        app.get('/rider/parcels', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).send({ message: 'Rider email is required' });
                }

                const query = {
                    assigned_rider_email: email,
                    delivery_status: { $in: ['rider_assigned', 'in_transit'] },
                };

                const options = {
                    sort: { creation_date: -1 }, // Newest first
                };

                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching rider tasks:', error);
                res.status(500).send({ message: 'Failed to get rider tasks' });
            }
        });

        // GET: Load completed parcel deliveries for a rider
        app.get('/rider/completed-parcels', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).send({ message: 'Rider email is required' });
                }

                const query = {
                    assigned_rider_email: email,
                    delivery_status: {
                        $in: ['delivered', 'service_center_delivered']
                    },
                };

                const options = {
                    sort: { creation_date: -1 }, // Latest first
                };

                const completedParcels = await parcelsCollection.find(query, options).toArray();

                res.send(completedParcels);

            } catch (error) {
                console.error('Error loading completed parcels:', error);
                res.status(500).send({ message: 'Failed to load completed deliveries' });
            }
        });


        app.patch("/parcels/:id/assign", async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName, riderEmail } = req.body;

            try {
                // Update parcel
                await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "rider_assigned",
                            assigned_rider_id: riderId,
                            assigned_rider_email: riderEmail,
                            assigned_rider_name: riderName,
                        },
                    }
                );

                // Update rider
                await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    {
                        $set: {
                            work_status: "in_delivery",
                        },
                    }
                );

                res.send({ message: "Rider assigned" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to assign rider" });
            }
        });

        app.patch("/parcels/:id/status", async (req, res) => {
            const parcelId = req.params.id;
            const { status } = req.body;
            const updatedDoc = {
                delivery_status: status
            }

            if (status === 'in_transit') {
                updatedDoc.picked_at = new Date().toISOString()
            }
            else if (status === 'delivered') {
                updatedDoc.delivered_at = new Date().toISOString()
            }

            try {
                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: updatedDoc
                    }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update status" });
            }
        });

        // Parcel Cashout related api
        app.patch("/parcels/:id/cashout", async (req, res) => {
            const id = req.params.id;
            const result = await parcelCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        cashout_status: "cashed_out",
                        cashed_out_at: new Date()
                    }
                }
            );
            res.send(result);
        });

        // Deleting the data
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                console.error('Error deleting parcel:', error);
                res.status(500).send({ message: 'Failed to delete parcel' });
            }
        });


        // Creating an intention to do a payment from card
        app.post('/create-payment-intent', async (req, res) => {

            const amountInCents = req.body.amountInCents;
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        // Tracking Apis
        app.get("/trackings/:trackingId", async (req, res) => {
            const trackingId = req.params.trackingId;

            const updates = await trackingsCollection
                .find({ tracking_id: trackingId })
                .sort({ timestamp: 1 }) // sort by time ascending
                .toArray();

            res.json(updates);
        });

        app.post("/trackings", async (req, res) => {
            const update = req.body;

            update.timestamp = new Date(); // ensure correct timestamp
            if (!update.tracking_id || !update.status) {
                return res.status(400).json({ message: "tracking_id and status are required." });
            }

            const result = await trackingsCollection.insertOne(update);
            res.status(201).json(result);
        });


        app.get('/payments', verifyFBToken, async (req, res) => {

            try {
                const userEmail = req.query.email;
                if (req.decoded.email !== userEmail) {
                    return res.status(403).send({ message: 'Forbidden Access' });
                }

                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } }; // Latest first

                const payments = await paymentsCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching payment history:', error);
                res.status(500).send({ message: 'Failed to get payments' });
            }
        });

        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, amount, paymentMethod, transactionId } = req.body;
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    { $set: { payment_status: 'paid' } }
                );
                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: 'Parcel not found or already paid' });
                }

                const paymentDoc = {
                    parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date()
                };
                const paymentResult = await paymentsCollection.insertOne(paymentDoc);
                res.status(201).send({
                    message: "Payment recorded and parcel marked as paid",
                    insertedId: paymentResult.insertedId,
                });
            } catch (error) {
                console.error('Payment processing failed:', error);
                res.status(500).send({ message: 'Failed to record payment' });
            }
        });



        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// Sample Route
app.get('/', (req, res) => {
    res.send('ProFast server is running...')
})

app.listen(port, () => {
    console.log(`ProFast is running on port ${port}`);
});