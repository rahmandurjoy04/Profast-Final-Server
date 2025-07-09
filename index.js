const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


dotenv.config();


const stripe = require("stripe")(process.env.PATMENT_GATEWAY_KEY);


const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: 'http://localhost:5173',  // Frontend URL
    credentials: true
}));
app.use(express.json());


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
        await client.connect();
        const db = client.db('profastDB')
        const parcelCollection = db.collection('parcels');
        const paymentsCollection = db.collection('payments');

        // Getting the data
        // app.get('/parcels', async (req, res) => {
        //     const parcels = await parcelCollection.find().toArray();
        //     res.send(parcels);
        // })

        // Parcels api
        app.get('/parcels', async (req, res) => {
            try {
                const userEmail = req.query.email;
                const query = userEmail ? { created_by: userEmail } : {};
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
        )
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
        app.post("/tracking", async (req, res) => {
            const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

            const log = {
                tracking_id,
                parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
                status,
                message,
                time: new Date(),
                updated_by,
            };

            const result = await trackingCollection.insertOne(log);
            res.send({ success: true, insertedId: result.insertedId });
        });

        app.get('/payments', async (req, res) => {
            try {
                const userEmail = req.query.email;
                console.log(req.query);

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
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
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