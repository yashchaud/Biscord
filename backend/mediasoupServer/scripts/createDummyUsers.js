const { createDummyUsers } = require('../LogicalFunctions/DummyUsers');
const path = require('path');

// Path to your sample video file (you'll need to provide this)
const videoFile = path.join(__dirname, '../assets/sample.webm');

async function main() {
    try {
        console.log('Creating dummy users...');
        const roomName = 'demo-room';
        const numberOfUsers = 3; // You can adjust this number

        const users = await createDummyUsers(numberOfUsers, roomName, videoFile);
        console.log(`Created ${users.length} dummy users in room: ${roomName}`);

        // Keep the script running
        process.on('SIGINT', async () => {
            console.log('Disconnecting dummy users...');
            users.forEach(user => user.disconnect());
            process.exit(0);
        });

    } catch (error) {
        console.error('Error creating dummy users:', error);
        process.exit(1);
    }
}

main(); 